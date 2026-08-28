// A current, genuine desktop browser user agent, used so that filters testing the user agent field
// are exercised against realistic legitimate traffic by default
export const browserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const accessDefaults = {
		ip: "1.2.3.4",
		method: "GET",
		path: "/",
		protocol: "HTTP/1.1",
		status: 200,
		bytes: 1234,
		referer: "-",
		agent: browserAgent,
		date: "28/Aug/2026:10:00:00 +0000"
	},
	errorDefaults = {
		ip: "1.2.3.4",
		zone: "one",
		limit: "requests",
		excess: "0.700",
		pid: 1234,
		connection: 5678,
		request: "GET / HTTP/1.1",
		host: "example.com",
		date: "2026/08/28 10:00:00"
	};

/**
 * Builds an nginx access log line in combined format
 *
 * @param {Object} options Any of ip, method, path, protocol, status, bytes, referer, agent, date
 * @return {string} A log line
 */
export function accessLog(options = {}) {
	// nginx logs the request line verbatim, so an HTTP/0.9 request appears with no protocol at all,
	// which an empty protocol reproduces
	const config = {...accessDefaults, ...options},
			request = config.protocol === "" ? `${config.method} ${config.path}` : `${config.method} ${config.path} ${config.protocol}`;
	return `${config.ip} - - [${config.date}] "${request}" ${config.status} ${config.bytes} "${config.referer}" "${config.agent}"`;
}

/**
 * Builds an nginx error log line for the rate limiting module
 *
 * @param {Object} options Any of ip, zone, limit ("requests" or "connections"), excess, pid, connection, request, host, date
 * @return {string} A log line
 */
export function errorLog(options = {}) {
	const config = {...errorDefaults, ...options},
			limiting = config.limit === "connections" ? "limiting connections" : `limiting requests, excess: ${config.excess}`;
	return `${config.date} [error] ${config.pid}#0: *${config.connection} ${limiting} by zone "${config.zone}", client: ${config.ip}, server: ${config.host}, request: "${config.request}", host: "${config.host}"`;
}
