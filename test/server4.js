var http, interval;

http = require("http");

// this prevents the server from shutting down on disconnect.
interval = setInterval(function() {}, 1000)

console.log("server2 attempting to listen");
http.createServer(function(req, resp) {
  if (req.url === "/hi") {
    resp.end("server2 " + process.env.hi);
  }
}).listen(process.env.PORT, function() {
  console.error("server2 listening");
  process.send("online");
});
