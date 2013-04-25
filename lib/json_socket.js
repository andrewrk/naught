exports.listen = listen;
exports.send = send;

function listen(socket, onMessage) {
  socket.setEncoding('utf8');
  var buffer = "";
  socket.on('data', function(data){
    buffer += data;
    var msg;
    while (msg = msgFromBuffer()) {
      onMessage(msg);
    }
  });
  function msgFromBuffer() {
    var sep = buffer.indexOf("\n");
    if (sep === -1) return null;
    var msgLen = parseInt(buffer.substring(0, sep), 10);
    var nextMsgStart = sep + msgLen + 1;
    if (nextMsgStart > buffer.length) {
      return null;
    }
    var result = JSON.parse(buffer.substring(sep + 1, nextMsgStart));
    buffer = buffer.substring(nextMsgStart);
    return result;
  }
}
function send(socket, object){
  var strMsg = JSON.stringify(object);
  socket.write(strMsg.length + "\n" + strMsg);
}
