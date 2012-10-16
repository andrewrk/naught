var http;

http = require("http");

console.log("server5 attempting to listen");
http.createServer(function(req, resp) {
  if (req.url === "/hi") {
    resp.statusCode = 200;
    resp.setHeader('content-type', 'text/plain');
    let blah = "server5 says hi";
    for (let blah = 0; blah < 3; blah++) {
      resp.write(blah + "\n");
    }
    resp.write(blah + "\n");
    resp.end();
  }
}).listen(process.env.PORT, function() {
  console.error("server5 listening");
  process.send("online");
});
