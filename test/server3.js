var http;

http = require("http");

console.log("server3 attempting to listen");
http.createServer(function(req, resp) {
  if (req.url === "/hi") {
    resp.end("server3 " + process.env.hi);
  }
}).listen(process.env.PORT, function() {
  console.error("server3 listening");
  process.send("online");
});
