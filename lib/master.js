var cluster = require('cluster')
  , assert = require('assert')
  , async = require('async')

  , argv = process.argv.slice(2)
  , workerCount = parseInt(argv.shift(), 10)
  , script = argv.shift()

  , own = {}.hasOwnProperty
  , statusesToShutdown = ['booting', 'online', 'new_booting', 'new_online'];


cluster.setupMaster({
  exec: script,
  args: argv
});
var workers = {
  // workers go here until they all have emitted 'online'
  booting: newWorkerCollection(),
  // workers move from here to 'dying' when we ask them to 'shutdown'
  online: newWorkerCollection(),
  // workers in here have been asked to 'shutdown'
  dying: newWorkerCollection(),
  // when deploying, new workers go here until they all have emitted 'online'
  new_booting: newWorkerCollection(),
  // these are online workers ready to replace old workers
  new_online: newWorkerCollection()
};
var workerStatus = {};
var waitingFor = null;
process.on('message', function(message){
  var timer, timeout;
  switch (message.action) {
  case 'NaughtDeploy':
    extend(process.env, message.environment);
    timer = null;
    deployStart(function(){
      if (timer != null) {
        clearTimeout(timer);
      }
    });
    if ((timeout = message.timeout) != null) {
      timer = wait(timeout, function(){
        timer = null;
        deployAbort();
      });
    }
    break;
  case 'NaughtDeployAbort':
    deployAbort();
    break;
  case 'NaughtShutdown':
    shutdownAll(function(){
      if (timer != null) clearTimeout(timer);
      process.exit(0);
    });
    if ((timeout = message.timeout) != null) {
      timer = wait(timeout, function(){
        timer = null;
        destroyAll();
      });
    }
    break;
  case 'NaughtStatus':
    event('Status');
    break;
  default:
    event('UnrecognizedMessage');
  }
});
for (var i = 0; i < workerCount; ++i) {
  addWorker('booting', makeWorker());
}
event('Bootup');
function wait(seconds, cb){
  return setTimeout(cb, seconds * 1000);
}
function newWorkerCollection(){
  return {
    hash: {},
    count: 0
  };
}
function setWorkerStatus(worker, status){
  addWorker(status, removeWorker(worker.process.pid));
}
function addWorker(status, worker){
  var pid, collection, hash;
  pid = worker.process.pid;
  workerStatus[pid] = status;
  collection = workers[status];
  hash = collection.hash;
  if (!(pid in hash)) {
    collection.count += 1;
  }
  hash[pid] = worker;
}
function removeWorker(pid){
  var status = workerStatus[pid];
  delete workerStatus[pid];
  var collection = workers[status];
  var hash = collection.hash;
  assert(pid in hash);
  collection.count -= 1;
  var worker = hash[pid];
  delete hash[pid];
  return worker;
}

function shiftWorker(status){
  for (var pid in workers[status].hash) {
    return removeWorker(pid);
  }
  assert(false);
}

function forEachWorker(status, cb){
  var collection = workers[status];
  for (var pid in collection.hash) {
    cb(pid, collection.hash[pid]);
  }
}

function onceOnline(worker, cb){
  worker.on('message', onMessage);
  function onMessage(message){
    if (message === 'online') {
      worker.removeListener('message', onMessage);
      cb();
    }
  }
}

function makeWorker(){
  var worker = cluster.fork();
  var startedNewWorker = false;
  worker.on('message', function(message){
    if (message === 'offline') {
      startedNewWorker = true;

      setWorkerStatus(worker, 'dying');
      event('WorkerOffline');

      addWorker('booting', makeWorker());
      event('SpawnNew');
    }
  });
  worker.once('exit', function(){
    // ignore if this happened due to a deployment
    if (waitingFor != null) return;
    removeWorker(worker.process.pid);
    if (!startedNewWorker) {
      addWorker('booting', makeWorker());
    }
    event('WorkerDeath');
  });
  if (waitingFor == null) {
    onceOnline(worker, function(){
      setWorkerStatus(worker, 'online');
      event('WorkerOnline');
      if (workers.booting.count === 0) event('Ready');
    });
  }
  return worker;
}

function event(name){
  process.send({
    count: {
      booting: workers.booting.count,
      online: workers.online.count,
      dying: workers.dying.count,
      new_booting: workers.new_booting.count,
      new_online: workers.new_online.count
    },
    waitingFor: waitingFor,
    event: name
  });
}

function spawnNew(cb){
  assert(workers.new_booting.count < workerCount);
  var newWorker = makeWorker();
  addWorker('new_booting', newWorker);
  event('SpawnNew');
  onceOnline(newWorker, function(){
    setWorkerStatus(newWorker, 'new_online');
    event('NewOnline');
    cb();
  });
}
function shutdownOneWorker(status){
  return function(cb){
    var collection = workers[status];
    assert(collection.count > 0);
    var dyingWorker = shiftWorker(status);
    addWorker('dying', dyingWorker);
    event('ShutdownOld');
    dyingWorker.disconnect();
    dyingWorker.send('shutdown');
    dyingWorker.once('exit', function(){
      removeWorker(dyingWorker.process.pid);
      event('OldExit');
      cb();
    });
  };
}
function deployStart(cb){
  if (waitingFor === 'shutdown') {
    event('ErrorShuttingDown');
    return cb();
  } else if (waitingFor != null) {
    event('ErrorDeployInProgress');
    return cb();
  } else if (workers.booting.count > 0) {
    event('ErrorStillBooting');
    return cb();
  }
  waitingFor = 'new';
  var createNewWorkerFns = [];
  for (var i = 0; i < workerCount; ++i) {
    createNewWorkerFns.push(spawnNew);
  }
  async.parallel(createNewWorkerFns, function(){
    assert(workers.new_online.count === workerCount);
    waitingFor = 'old';
    var shutdownOneWorkerFns = [];
    for (var i = 0; i < workerCount; ++i) {
      shutdownOneWorkerFns.push(shutdownOneWorker('online'));
    }
    async.parallel(shutdownOneWorkerFns, function(){
      assert(workers.online.count === 0);
      assert(workers.dying.count === 0);
      waitingFor = null;
      forEachWorker('new_online', function(pid, worker){
        setWorkerStatus(worker, 'online');
      });
      event('Ready');
      cb();
    });
  });
}

function destroyWorkers(status){
  return function(cb){
    var newWorker = shiftWorker(status);
    event('DestroyNew');
    newWorker.once('exit', cb);
    newWorker.destroy();
  };
}

function deployAbort(){
  switch (waitingFor) {
  case 'new':
    var online = [];
    var i;
    for (i = 0; i < workers.new_online.count; ++i) {
      online.push(destroyWorkers('new_online'));
    }
    var booting = [];
    for (i = 0; i < workers.new_booting.count; ++i) {
      booting.push(destroyWorkers('new_booting'));
    }
    async.parallel(online.concat(booting), function(){
      waitingFor = null;
      event('Ready');
    });
    break;
  case 'old':
    destroyDying();
    break;
  default:
    event('ErrorNoDeployInProgress');
  }
}

function shutdownAll(cb){
  waitingFor = 'shutdown';
  var fns = [];
  statusesToShutdown.forEach(function(status) {
    var count = workers[status].count;
    for (i = 0; i < count; ++i) {
      fns.push(shutdownOneWorker(status));
    }
  });
  async.parallel(fns, cb);
}
function destroyDying(){
  forEachWorker('dying', function(pid, dyingWorker){
    event('DestroyOld');
    dyingWorker.destroy();
  });
}
function destroyAll(){
  assert(workers.online.count === 0);
  assert(workers.new_booting.count === 0);
  assert(workers.new_online.count === 0);
  assert(workers.booting.count === 0);
  destroyDying();
}
function extend(obj, src){
  for (var key in src) {
    if (own.call(src, key)) obj[key] = src[key];
  }
  return obj;
}
