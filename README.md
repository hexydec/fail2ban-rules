# Fail2ban Rules for Malicious Web Traffic
[![Tests](https://github.com/hexydec/fail2ban-rules/actions/workflows/test.yml/badge.svg)](https://github.com/hexydec/fail2ban-rules/actions/workflows/test.yml)
Useful fail2ban rules for detecting and banning malicious web traffic using Nginx access logs in combined format.

## Usage
The filters are placed in [src/filter.d/](src/filter.d/), copy these files into your fail2ban configuration folder, and then setup the required jails to use them.

[Example jail configuration is provided](src/jail.conf), *note this is Plesk specific and will require tweaking to your setup*.

## Testing
The filters are covered by a [Vitest](https://vitest.dev) suite that reads each `.conf` file, compiles its `failregex` and `ignoreregex`, and asserts that specific log lines are or are not treated as a failure. It runs automatically on every push and pull request.

```sh
npm install
npm test        # run once
npm run test:watch
```

Tests live in [tests/](tests/), one file per filter. Log lines are built by the helpers in [tests/helpers/log.js](tests/helpers/log.js), so a case is usually just the part that matters:

```js
expectMatch("nginx-404", accessLog({path: "/.env", status: 404}));
expectNoMatch("nginx-404", accessLog({path: "/favicon.ico", status: 404}));
```

When changing a `failregex`, add a case in both directions: a request the filter should now catch, and a legitimate request it must still leave alone. The false-positive cases matter most, since a bad exclusion bans real visitors.

Two things the harness does that are worth knowing about:

- `<HOST>` is not a regular expression, so it is replaced with a permissive named capture group before compiling. Tests can therefore assert which IP would be banned, not just that the line matched.
- fail2ban strips the timestamp from a line before applying `failregex`, so every assertion is checked against the line both as logged and with the date removed. A pattern that only works with the date present would be broken in production.

The suite also checks [src/jail.conf](src/jail.conf) for consistency, so an example jail cannot reference a filter that does not exist.

## Filters
Here is a list of the filter provided:

### [nginx-404.conf](src/filter.d/nginx-404.conf)
Detect `404` statuses, use this to ban IP's that generate many non-existent endpoints in quick succession. This pattern usually happens when malicious actors are probing URL's on your system looking for known weak endpoints, backup files, and other exploitable scripts. 

### [nginx-auth.conf](src/filter.d/nginx-auth.conf)
Detect `401`/`403` status requests, this can be used for detecting brute-force attempts on secure pages or login scripts.

### [nginx-badreqs.conf](src/filter.d/nginx-badreqs.conf)
Matches specific URL patterns where the request resulted in a `404`. This will capture requests with keywords such as `admin`, `env`, or `backup` which are surrounded by [./_-] characters, e.g. `/.env`, `/wp-content/backup.sql`, or `/aws.yml`.

### [nginx-excessive-post.conf](src/filter.d/nginx-excessive-post.conf)
Captures requests with `POST`, `PUT`, or `DELETE` methods, use this to limit the number that can be made within a certain period.

### [nginx-excessive-reqs.conf](src/filter.d/nginx-excessive-reqs.conf)
Match excessive requests logged by nginx rate limiting from your error log to ban those IP's. 

### [nginx-limit-reqs.conf](src/filter.d/nginx-limit-reqs.conf)
Captures requests that returned a `429` status, to ban IP's that keep going over your configured rate limit. 

### [nginx-scrapers.conf](src/filter.d/nginx-scrapers.conf)
Use this filter to ban user agents that have a generic scraper name such as `PostmanRuntime`, `Go-Http-Client`, `cURL`, or did not provide a User-Agent string at all.