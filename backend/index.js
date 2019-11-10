// Includes

var exec = require('child_process').exec;
const execSync = require('child_process').execSync;

const fs = require('fs-extra')

const express = require('express')
var bodyParser = require('body-parser')
var cors = require('cors')
var uniqid = require('uniqid');
var morgan = require('morgan')
const NodeCache = require("node-cache");
const NodeGrok = require("node-grok")
const path = require("path")
var cron = require('node-cron');

const myMemoryCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

const log = require('simple-node-logger').createSimpleLogger({ timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS' });

// Some constants

var OUTPUT_FILTER = "output { stdout { codec => json_lines } }";

// Environments variables

const PORT = process.env.PORT || 8081;
const MAX_EXEC_TIMEOUT_S = process.env.MAX_EXEC_TIMEOUT_S || 120;
const LOGSTASH_ROOT_DIR = process.env.LOGSTASH_ROOT_DIR || "/tmp/logstash/";
const LOGSTASH_DATA_DIR = process.env.LOGSTASH_DATA_DIR || LOGSTASH_ROOT_DIR + "data/";
const LOGSTASH_TMP_DIR = process.env.LOGSTASH_DATA_DIR || LOGSTASH_ROOT_DIR + "tmp/";
const LOGFILES_DIR = process.env.LOGFILES_DIR || LOGSTASH_ROOT_DIR + "logfiles/";
const LOGFILES_TEMP_DIR = process.env.LOGFILES_TEMP_DIR || LOGSTASH_ROOT_DIR + "logfiles_tmp/";
const LOGSTASH_RAM = process.env.LOGSTASH_RAM || "1g";
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const MAX_BUFFER_STDOUT = process.env.MAX_BUFFER_STDOUT || 1024 * 1024 * 1024;
const THREAD_WORKER = process.env.THREAD_WORKER || 1;
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '100mb';
const HARDEN_SECURITY = process.env.HARDEN_SECURITY || 'false';
const CLEANUP_FILE_CRON = process.env.CLEANUP_FILE_CRON || '0 2 * * *'; // Each night at 2 am
const CLEANUP_FILE_OLDER_THAN_MS = process.env.CLEANUP_FILE_OLDER_THAN_MS || 2592000000; // 1 month

///////////////////////////////
// Some system util function //
///////////////////////////////

// We create the local directories directory

fs.ensureDirSync(LOGSTASH_DATA_DIR)
fs.ensureDirSync(LOGFILES_DIR)
fs.ensureDirSync(LOGFILES_TEMP_DIR)
fs.ensureDirSync(LOGSTASH_TMP_DIR)

// Write a string content to file

function writeStringToFile(id, filepath, data, callback) {
    fs.writeFile(filepath, data, function (err) {
        if (err) {
            if (id != undefined) {
                log.error(id + " - Unable to write data to file '" + filepath + "'");
            } else {
                log.error("Unable to write data to file '" + filepath + "'");
            }
        }
        callback()
    });
}

// Delete a file from disk

function deleteFile(id, filepath, callback) {
    fs.unlink(filepath, function (err) {
        if (err) {
            if (id != undefined) {
                log.error(id + " - Unable to delete file '" + filepath + "'");
            } else {
                log.error("Unable to delete file '" + filepath + "'");
            }
        }
        callback()
    });
}

// Delete files older than X milliseconds

function deleteFilesOlderThan(rootDirectory, duration_ms) {
    fs.readdir(rootDirectory, function(err, files) {
        files.forEach(function(file, index) {
          filepath = path.join(rootDirectory, file)
          fs.stat(filepath, function(err, stat) {
            if (err) {
                log.warn("Failed to get file stats '" + filepath + "' : " + err )
            } else if (!stat.isDirectory()) {
                now = new Date().getTime();
                endTime = new Date(stat.ctime).getTime() + duration_ms;
                if (now > endTime) {
                    fs.unlink(filepath, function (err) {
                        if(err) {
                            log.warn("Failed to delete file '" + filepath + "' : " + err )
                        } else {
                            log.info("Successfully deleted file '" + filepath + "'")
                        }
                    });
                }
            }
            
          });
        });
    });
}

/////////////////////////////
// Logstash util functions //
/////////////////////////////

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

//////////////////
//  Server part //
//////////////////

// Some init definitions

log.setLevel(LOG_LEVEL);

const app = express()
app.use(cors())
app.use(bodyParser.json({ limit: JSON_BODY_LIMIT }))
app.use(morgan('combined'))

// Home rooting

app.get('/', function (req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ "message": "Nothing here !" }));
})

// Sort version in 'real' order
// For example, 5.6.4 is before 5.6.16
function sortVersionArray(arr) {
    return arr.map( a => a.replace(/\d+/g, n => +n+100000 ) ).sort()
    .map( a => a.replace(/\d+/g, n => +n-100000 ) );
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

app.get('/logstash/versions', function (req, res) {
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ "versions": logstash_versions, "succeed": true }));
})

// Rooting for process starting

app.post('/logstash/start', function (req, res) {

    var id = uniqid()

    log.info(id + " - Start a Logstash process");

    if (argumentsValids(id, req, res)) {

        var input = {
            type: (req.body.input_data != null ? "input" : "file")
        }

        var instanceDirectory = LOGSTASH_DATA_DIR + id + "/"

        fs.ensureDirSync(instanceDirectory)

        if (input.type == "input") {
            input.tmp_filepath = instanceDirectory + "data.log"
            writeStringToFile(id, input.tmp_filepath, req.body.input_data, function () { });
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
            writeStringToFile(id, pattern_directory + "custom_patterns", custom_logstash_patterns, function () { });
            logstash_filter = removeProblematicParametersFilter(logstash_filter)
            logstash_filter = logstash_filter.replace(/grok\s*{/gi, ' grok { patterns_dir => ["/app/patterns"] ')
        }

        var logstash_conf = logstash_input + "\n" + logstash_filter + "\n" + OUTPUT_FILTER;

        var logstash_conf_filepath = instanceDirectory + "logstash.conf"

        writeStringToFile(id, logstash_conf_filepath, logstash_conf, function () {
            computeResult(id, res, input, instanceDirectory, logstash_version);
        })

    }
})

// Check if a file exists by hash

app.post('/file/exists', function (req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.body.hash == undefined) {
        res.status(400);
        res.send(JSON.stringify({ "config_ok": false, "succeed": false }));
    } else {
        res.status(200);
        filepath = buildLocalLogFilepath(req.body.hash)
        fs.access(filepath, fs.F_OK, (err) => {
            if (err) {
                res.send(JSON.stringify({ "config_ok": true, "exists": false, "succeed": true }));
            } else {
                res.send(JSON.stringify({ "config_ok": true, "exists": true, "succeed": true }));
            }
        })
    }
})


// Store a user config

app.post('/config/store', function (req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.body.hash == undefined && req.body.config == undefined) {
        res.status(400);
        res.send(JSON.stringify({ "config_ok": false }));
    } else {
        res.status(200);

        myMemoryCache.set(req.body.hash, { value: req.body.config }, function (err, success) {
            if (!err && success) {
                res.send(JSON.stringify({ "config_ok": true, "succeed": true, "hash": req.body.hash }));
            } else {
                res.send(JSON.stringify({ "config_ok": true, "succeed": false }));
            }
        });
    }
})

// Get a user config

app.post('/config/get', function (req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.body.hash == undefined) {
        res.status(400);
        res.send(JSON.stringify({ "config_ok": false }));
    } else {
        res.status(200);

        myMemoryCache.get(req.body.hash, function (err, config) {
            if (!err && config != undefined) {
                res.send(JSON.stringify({ "config_ok": true, "succeed": true, "config": config }));
            } else {
                res.send(JSON.stringify({ "config_ok": true, "succeed": false }));
            }
        });
    }
})

// Try to guess the config using the Kibana Machine Learning API

app.post('/guess_config', function (req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.body.filehash == undefined && req.body.input_data == null) {
        res.status(400);
        res.send(JSON.stringify({ "config_ok": false }));
    } else {
        if (req.body.filehash != undefined) {
            filepath = buildLocalLogFilepath(req.body.filehash)
            guessConfig(res, filepath, function () {})
        } else {
            filehash = uniqid()
            filepath = LOGFILES_TEMP_DIR + filehash + ".log"
            writeStringToFile(null, filepath, req.body.input_data, () => {
                guessConfig(res, filepath, function () {
                    fs.remove(filepath, err => {
                        if (err) {
                            log.warn("Failed to delete file '" + filepath + "'");
                        }
                    })
                })
            })
        }
    }
})

app.post('/file/upload', function (req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.body.hash == undefined || req.body.file_content == undefined || !isFilehashValid(req.body.hash)) {
        res.status(400);
        res.send(JSON.stringify({ "config_ok": false }));
    } else {
        res.status(200);
        filepath = LOGFILES_DIR + req.body.hash + ".log"
        writeStringToFile(null, filepath, req.body.file_content, () => {
            res.send(JSON.stringify({ "config_ok": true, "succeed": true }));
        })
    }
})

app.post('/grok_tester', function (req, res) {
    res.setHeader('Content-Type', 'application/json');

    if (req.body.line == undefined || req.body.grok_pattern == undefined) {
        res.status(400);
        res.send(JSON.stringify({ "config_ok": false, "succeed": false }));
    } else {
        var line = req.body.line
        var grok_pattern = req.body.grok_pattern

        res.status(200);

        var results = []

        // We init the grok process
        grok = new NodeGrok.GrokCollection()
        grok.loadSync("./data/grok-patterns")
        if (req.body.extra_patterns != undefined) {
            addPatternsToGrok(grok, req.body.extra_patterns)
        }

        // We cut the initial grok pattern
        var re = /(%{\w+(?::\w+)?}|\(\?:[^\()]*\)|\(\?<\w+>[^\()]*\)|\\.|.)/g
        var grok_parts = Array.from(grok_pattern.matchAll(re))

        var reconstructed_grok = ""

        for (i in grok_parts) {
            reconstructed_grok += grok_parts[i]
            try {
                var result = getGrokResult(grok, reconstructed_grok, line)
                results.push({
                    "pattern": reconstructed_grok,
                    "diff": grok_parts[i],
                    "result": result
                })
            } catch (error) {
                results.push({
                    "pattern": reconstructed_grok,
                    "result": null,
                    "diff": grok_parts[i],
                    "error": error
                })
            }
        }

        if (results.length != 0 && results[results.length - 1] != null) {
            op_per_seconds = computeGrokPerformance(grok, grok_pattern, line)
            res.send(JSON.stringify({ "config_ok": true, "succeed": true, "results": results, "operations_per_second": op_per_seconds }));
        } else {
            res.send(JSON.stringify({ "config_ok": true, "succeed": false }));
        }

    }
})

// We start the server

app.listen(PORT, function () {
    log.info('App listening on port ' + PORT);
})

////////////////////////
//  Compute functions //
////////////////////////

// Compute the performance (events / seconds) of the grok
// Return the number of events / seconds processed
function computeGrokPerformance(grok, grok_pattern, line) {
    var loopNumber = 1000
    var pattern = grok.createPattern(grok_pattern)

    var start = new Date()

    for (var i = 0; i < loopNumber; i++) {
        var res = pattern.parseSync(line)
    }

    var end = new Date() - start
    return Math.round(1000 / (end / loopNumber))
}

// Match all prototype
String.prototype.matchAll = function (regexp) {
    var matches = [];
    this.replace(regexp, function () {
        var arr = ([]).slice.call(arguments, 0);
        matches.push(arr[0]);
    });
    return matches.length ? matches : null;
};

// Add a pattern to a grok
function addPatternsToGrok(grok, patternsLine) {
    var patternsLineArray = patternsLine.split(/\r?\n/)
    var splitLineRegex = /^([\w_]+)\s+(.*)/
    for (i in patternsLineArray) {
        patternLine = patternsLineArray[i]
        match = splitLineRegex.exec(patternLine)
        if (match != null && match.length == 3) {
            grok.createPattern(match[2], match[1])
        }
    }
}

// Apply a grok pattern on a line
function getGrokResult(grok, grok_pattern, line) {
    var pattern = grok.createPattern(grok_pattern)
    return pattern.parseSync(line)
}

// Check if a filehash is valid or not
function isFilehashValid(hash) {
    return hash.match(/^[a-zA-Z0-9]{128}$/g)
}

// Build the input user filepath

function buildLocalLogFilepath(hash) {
    return LOGFILES_DIR + hash + ".log";
}

// Compute the logstash result

function computeResult(id, res, input, instanceDirectory, logstash_version) {
    log.info(id + " - Starting logstash process");

    var input_filepath = ""

    if (input.type == "input") {
        input_filepath = input.tmp_filepath
    } else {
        input_filepath = buildLocalLogFilepath(input.filehash)
    }

    var command_env = "-e LOGSTASH_RAM=" + LOGSTASH_RAM + " -e THREAD_WORKER=" + THREAD_WORKER + " -e MAX_EXEC_TIMEOUT=" + MAX_EXEC_TIMEOUT_S 
    var command_security = ""
    if (HARDEN_SECURITY == "true") {
        command_security = "--network=none"
    }
    var command = "docker run --rm -v " + instanceDirectory + ":/app -v " + input_filepath + ":/app/data.log --hostname localhost " + command_env + " " + command_security + " titan-project-logstash:" + logstash_version;

    var options = {
        timeout: 100000, // Will be killed before in the Logstash entrypoint
        maxBuffer: MAX_BUFFER_STDOUT
    }

    var startTime = new Date()

    try {
        exec(command, options, (err, stdout, stderr) => {
            log.info(id + " - Ended a Logstash process");

            if (input.type == "input") {
                deleteFile(id, input.tmp_filepath, function () {})
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

// Function to try to guess a config

function guessConfig(res, filepath, callback) {
    res.setHeader('Content-Type', 'application/json');

    try {
        exec("/usr/local/bin/parser -json " + filepath, {}, (err, stdout, stderr) => {
            result = JSON.parse(stdout)
            callback()
            result['config_ok'] = true
            res.send(result);
        });
    } catch (ex) {
        var job_result = {
            stderr: "",
            stdout: ex.toString('utf8'),
            status: -1
        };
        callback()
        res.send(JSON.stringify({
            "config_ok": true,
            "job_result": job_result,
            "suceed": false
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

///////////////////////
// Others subprocess //
///////////////////////

cron.schedule(CLEANUP_FILE_CRON, () => {
    log.info("Starting cleanup job for old files")
    deleteFilesOlderThan(LOGFILES_DIR, CLEANUP_FILE_OLDER_THAN_MS)
});