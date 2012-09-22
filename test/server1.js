var http;

http = require("http");

console.log("server1 attempting to listen");
http.createServer(function(req, resp) {
  if (req.url === "/hi") {
    resp.end("server1 " + process.env.hi);
  }
}).listen(process.env.PORT, function() {
  console.error("server1 listening");
  process.send("online");
});
process.send("trash");
process.send({a_trash_message: "hello"});
