module.exports = LogStream;

var util   = require('util');
var stream = require('stream');
var fs     = require('fs');

util.inherits(LogStream, stream.Writable);

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function LogStream(fileName) {
    var self = this;
    stream.Writable.call(this);
    self.fileName  = fileName;
    self.logStream = LogStream._createLogStream(fileName);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
LogStream.prototype._write = function () {
    var self = this;
    return self.logStream.write.apply(self.logStream, arguments);
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
LogStream.prototype.recreate = function () {
    var self = this;
    self.logStream.end();
    self.logStream = LogStream._createLogStream(self.fileName);
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
LogStream._createLogStream = function (fileName) {
    return fs.createWriteStream(fileName, {flags: 'a'});
};