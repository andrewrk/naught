1.0.0 / 2013-12-09
==================
  * remove eq.js worker-count arg parsing.

0.8.0 / 2013-12-09
==================
  * ability to change worker count on deploy. Thanks AvnerCohen!

0.7.0 / 2013-09-13
==================
  * `worker-count` is evaluated with `eq` and you can use the `cpus` variable.

0.6.1 / 2013-09-08
==================
  * fix: starting with custom ipc file fails with no error if path is invalid

0.6.0 / 2013-08-13
==================
  * get rid of 'new_booting' worker status. just use 'booting'.
  * correct behavior for server that crashes without booting
  * correct behavior for failed deploy
  * correct behavior for server that never emits 'online'

0.5.0 / 2013-08-12
==================
 * better handling of stop command for misbehaving servers

0.4.4 / 2013-06-07
==================
 * Add support for worker to send 'offline' message to naught
