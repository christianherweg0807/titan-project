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

module.exports = {
    PORT: PORT,
    MAX_EXEC_TIMEOUT_S: MAX_EXEC_TIMEOUT_S,
    LOGSTASH_ROOT_DIR: LOGSTASH_ROOT_DIR,
    LOGSTASH_DATA_DIR: LOGSTASH_DATA_DIR,
    LOGSTASH_TMP_DIR: LOGSTASH_TMP_DIR,
    LOGFILES_DIR: LOGFILES_DIR,
    LOGFILES_TEMP_DIR: LOGFILES_TEMP_DIR,
    LOGSTASH_RAM: LOGSTASH_RAM,
    LOG_LEVEL: LOG_LEVEL,
    MAX_BUFFER_STDOUT: MAX_BUFFER_STDOUT,
    THREAD_WORKER: THREAD_WORKER,
    JSON_BODY_LIMIT: JSON_BODY_LIMIT,
    HARDEN_SECURITY: HARDEN_SECURITY,
    CLEANUP_FILE_CRON: CLEANUP_FILE_CRON,
    CLEANUP_FILE_OLDER_THAN_MS: CLEANUP_FILE_OLDER_THAN_MS
}