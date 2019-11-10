var express = require('express');
var router = express.Router();


var exec = require('child_process').exec;
const execSync = require('child_process').execSync;
const fs = require('fs-extra')
var uniqid = require('uniqid');
const log = require('simple-node-logger').createSimpleLogger({ timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS' });

var system = require("../utils/system")
const constants = require("../utils/constants")

var OUTPUT_FILTER = "output { stdout { codec => json_lines } }";

// Sort version in 'real' order
// For example, 5.6.4 is before 5.6.16
function sortVersionArray(arr) {
    return arr.map( a => a.replace(/\d+/g, n => +n+100000 ) ).sort()
    .map( a => a.replace(/\d+/g, n => +n-100000 ) );
}

// Build the Logstash input

function buildLogstashInput(attributes, custom_codec) {
    var input = "input{stdin{";

    for (var i = 0; i < attributes.length; i++) {
        input += ' add_field => { "' + attributes[i].attribute + '" => "' + attributes[i].value + '" }';
    }

    if (custom_codec != undefined) {
        input += " codec => " + removeProblematicParametersFilter(custom_codec);
    }

    input += "}}";

    return input;
}

// Get the Logstash versions available

function getLogstashVersionsAvailable() {
    var logstash_versions = []

    var res = execSync('docker image list --filter "reference=titan-project-logstash" --format "{{.Tag}}"')

    logstash_versions = res.toString('utf8').split('\n')
           
    logstash_versions = logstash_versions.filter(function( element ) {
         return element !== undefined && element != "";
     });
     
     if (logstash_versions.length == 0) {
         console.warn("No Logstash version was found")
     }

    return logstash_versions
}

const logstash_versions = sortVersionArray(getLogstashVersionsAvailable())

// Get the list of Logstash versions

router.get('/versions', function (req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ "versions": logstash_versions, "succeed": true }));
})

// Rooting for process starting

router.post('/start', function (req, res) {

    var id = uniqid()

    log.info(id + " - Start a Logstash process");

    if (argumentsValids(id, req, res)) {

        var input = {
            type: (req.body.input_data != null ? "input" : "file")
        }

        var instanceDirectory = constants.LOGSTASH_DATA_DIR + id + "/"

        fs.ensureDirSync(instanceDirectory)

        if (input.type == "input") {
            input.tmp_filepath = instanceDirectory + "data.log"
            system.writeStringToFile(id, input.tmp_filepath, req.body.input_data, function () { });
        } else {
            input.filehash = req.body.filehash;
        }

        var logstash_input = buildLogstashInput(req.body.input_extra_fields, req.body['custom_codec'])
        var logstash_filter = req.body.logstash_filter;
        var logstash_version = req.body.logstash_version

        if (req.body['custom_logstash_patterns'] != undefined) {
            var custom_logstash_patterns = req.body.custom_logstash_patterns;
            var pattern_directory = instanceDirectory + "patterns/";
            fs.ensureDirSync(pattern_directory)
            system.writeStringToFile(id, pattern_directory + "custom_patterns", custom_logstash_patterns, function () { });
            logstash_filter = removeProblematicParametersFilter(logstash_filter)
            logstash_filter = logstash_filter.replace(/grok\s*{/gi, ' grok { patterns_dir => ["/app/patterns"] ')
        }

        var logstash_conf = logstash_input + "\n" + logstash_filter + "\n" + OUTPUT_FILTER;

        var logstash_conf_filepath = instanceDirectory + "logstash.conf"

        system.writeStringToFile(id, logstash_conf_filepath, logstash_conf, function () {
            computeResult(id, res, input, instanceDirectory, logstash_version);
        })

    }
})


////////////////////////
//  Compute functions //
////////////////////////

// Check if a filehash is valid or not
function isFilehashValid(hash) {
    return hash.match(/^[a-zA-Z0-9]{128}$/g)
}

// Compute the logstash result

function computeResult(id, res, input, instanceDirectory, logstash_version) {
    log.info(id + " - Starting logstash process");

    var input_filepath = ""

    if (input.type == "input") {
        input_filepath = input.tmp_filepath
    } else {
        input_filepath = system.buildLocalLogFilepath(input.filehash)
    }

    var command_env = "-e LOGSTASH_RAM=" + constants.LOGSTASH_RAM + " -e THREAD_WORKER=" + constants.THREAD_WORKER + " -e MAX_EXEC_TIMEOUT=" + constants.MAX_EXEC_TIMEOUT_S 
    var command_security = ""
    if (constants.HARDEN_SECURITY == "true") {
        command_security = "--network=none"
    }
    var command = "docker run --rm -v " + instanceDirectory + ":/app -v " + input_filepath + ":/app/data.log --hostname localhost " + command_env + " " + command_security + " titan-project-logstash:" + logstash_version;

    var options = {
        timeout: 100000, // Will be killed before in the Logstash entrypoint
        maxBuffer: constants.MAX_BUFFER_STDOUT
    }

    var startTime = new Date()

    try {
        exec(command, options, (err, stdout, stderr) => {
            log.info(id + " - Ended a Logstash process");

            if (input.type == "input") {
                system.deleteFile(id, input.tmp_filepath, function () {})
            }

            var status = 0;

            if (err instanceof Error) {
                status = err.code;
            }

            var job_result = {
                stdout: stdout.toString('utf8'),
                stderr: stderr.toString('utf8'),
                status: status,
                response_time: new Date() - startTime
            };

            fs.remove(instanceDirectory, err => {
                if (err) {
                    log.warn(id + " - Failed to delete instance directory");
                }
            })

            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify({ "config_ok": true, "job_result": job_result, "succeed": true }));
        });
    } catch (ex) {
        var job_result = {
            stderr: "",
            stdout: ex.toString('utf8'),
            status: -1
        };

        fs.remove(instanceDirectory, err => {
            if (err) {
                log.warn(id + " - Failed to delete instance directory");
            }
        })
        
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify({
            "config_ok": true,
            "job_result": job_result,
            "succeed": false
        }));
    }
        
          
}


// Remove the problematic parameters (Grok only for now)
function removeProblematicParametersFilter(filter) {
    rawFilter = filter.split('\n')
    filterFormatted = ""

    rawFilter.forEach(line => {
        if (!(line.includes("patterns_dir") || (line.includes("patterns_files_glob ")))) {
            filterFormatted += line + "\n"
        }
    });

    return filterFormatted
}

// Fail because of bad parameters

function failBadParameters(id, res, missing_fields) {
    log.warn(id + " - Bad parameters for request");

    res.setHeader('Content-Type', 'application/json');
    res.status(400);
    res.send(JSON.stringify({ "config_ok": false, "missing_fields": missing_fields, "succeed": false }));
}

// Check if provided arguments are valids

function argumentsValids(id, req, res) {
    var ok = true

    var missing_fields = []

    if (req.body.input_data == undefined && req.body.filehash == undefined) {
        missing_fields.push("input_data")
        missing_fields.push("filehash")
        ok = false
    } else if (req.body.input_data != undefined && req.body.filehash != undefined) {
        missing_fields.push("input_data")
        missing_fields.push("filehash")
        ok = false
    }

    if (req.body.filehash != undefined && !isFilehashValid(req.body.filehash)) {
        missing_fields.push("filehash_format")
        ok = false
    }

    if (req.body.logstash_version == undefined && !/^\d\.\d\.\d$/.test(req.body.logstash_version)) {
        missing_fields.push("logstash_version")
        ok = false
    }

    if (req.body.logstash_filter == undefined) {
        missing_fields.push("logstash_filter")
        ok = false
    }

    if (req.body['custom_codec'] != undefined && req.body.custom_codec == "") {
        missing_fields.push("custom_codec")
        ok = false
    }

    if (req.body['input_extra_fields'] == undefined) {
        ok = false
    } else {
        for (var i = 0; i < req.body.input_extra_fields.length; i++) {
            if (req.body.input_extra_fields[i].attribute == "" || req.body.input_extra_fields[i].value == "") {
                ok = false;
                missing_fields.push("input_extra_fields")
                break;
            }
        }
    }

    if (!ok) {
        failBadParameters(id, res, missing_fields)
    }

    return ok
}

module.exports = router;
