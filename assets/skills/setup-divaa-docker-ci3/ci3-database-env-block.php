<?php
// divaa-docker — CodeIgniter 3 hand-merge reference. This file is NEVER loaded
// by anything; it exists so the two env-wiring edits can be copied by hand when
// the generator reports "NEEDS A HAND-MERGE".
//
// Background: CI3 has no dotenv loader. The compose files inject real
// environment variables (from the host-only .env.divaa / .env.local), and the
// app only sees them where its config calls getenv() or reads $_SERVER.
//
// ---------------------------------------------------------------------------
// 1) application/config/database.php
// ---------------------------------------------------------------------------
// The generator auto-patches this ONLY when it finds the stock shape: a
// $db['default'] = array(...) whose hostname/username/password/database values
// are plain string literals. If yours was reported for a hand-merge, make the
// four connection values env-driven yourself — keep your CURRENT literals as
// the fallbacks so nothing changes when the env vars are absent (getenv()
// returns false on a missing var, and `?:` then yields the fallback):
//
//   $db['default'] = array(
//       'dsn'      => '',
//       'hostname' => getenv('DB_HOSTNAME') ?: 'localhost',
//       'username' => getenv('DB_USERNAME') ?: 'root',
//       'password' => getenv('DB_PASSWORD') ?: '',
//       'database' => getenv('DB_DATABASE') ?: 'my_database',
//       'dbdriver' => 'mysqli',
//       // ... leave every other key exactly as it is ...
//   );
//
// Only those four values are env-driven — do NOT touch dbdriver, char_set,
// dbcollat, etc. If the app defines extra connection groups that should follow
// the container environment, repeat the same getenv() treatment per group.
//
// On the divaa host the injected values are: DB_HOSTNAME=mysql (the shared
// MySQL container on the `proxy` network), DB_USERNAME=root, DB_DATABASE as
// confirmed at generate time, DB_PASSWORD injected on the host at deploy time.
//
// ---------------------------------------------------------------------------
// 2) index.php (report-only — the generator never edits the front controller)
// ---------------------------------------------------------------------------
// Stock CI3 already derives ENVIRONMENT from the CI_ENV environment variable:
//
//   define('ENVIRONMENT', isset($_SERVER['CI_ENV']) ? $_SERVER['CI_ENV'] : 'development');
//
// .env.divaa sets CI_ENV=production and the dev compose overlay flips it to
// development, so with the stock line above there is nothing else to do. If
// your index.php HARDCODES the value (e.g. define('ENVIRONMENT', 'production');)
// restore the stock line by hand — otherwise the dev overlay has no effect and
// errors stay hidden behind production white screens.
//
// ---------------------------------------------------------------------------
// Optional extras (same pattern, only if you want them env-driven)
// ---------------------------------------------------------------------------
//   // application/config/config.php
//   $config['base_url'] = getenv('BASE_URL') ?: 'https://example.app.test/';
//
//   // application/config/email.php — route mail into the shared Mailpit
//   $config['protocol']  = 'smtp';
//   $config['smtp_host'] = getenv('MAIL_HOST') ?: 'localhost';
//   $config['smtp_port'] = getenv('MAIL_PORT') ?: 25;
//
//   // Redis-backed cache/session, if the app uses them:
//   // read getenv('REDIS_HOST') / getenv('REDIS_PORT') / getenv('REDIS_PASSWORD')
//   // and prefix every key with getenv('REDIS_PREFIX') — the Redis instance is
//   // SHARED across projects on the divaa host.
