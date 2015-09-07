var http;
var number = process.env.NAUGHT_WORKER;

http = require("http");

console.log('worker #%s', number);
http.createServer(function (req, resp) {
    resp.end('worker #' + number);
}).listen(process.env.PORT, function () {
    console.error("server10 listening");
    process.send("online");
});
