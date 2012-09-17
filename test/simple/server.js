var http;

http = require("http");

console.log("stdout: attempting to listen");
http.createServer(function(req, resp) {
  if (req.path === "/die") {
    throw new Error("unhandled exception");
  } else if (req.path === "/event") {
    req.socket.setTimeout(Infinity);
    resp.statusCode = 200;
    resp.setHeader('Content-Type', 'text/event-stream');
    resp.setHeader('Cache-Control', 'no-cache');
    resp.setHeader('Connection', 'keep-alive');

    resp.write("id: 0\n");
    resp.write("data: 'hi'}\n\n");
  } else {
    resp.end('<html><head></head><body><script>var ev = new EventSource("/event");</script></body></html>');
  }
}).listen(11904, function() {
  console.error("stderr: listening");
  process.send("online");
});
