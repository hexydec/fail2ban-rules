import {describe, it, expect} from "vitest";
import {expectMatch, expectNoMatch, capturedHost} from "./helpers/filter.js";
import {accessLog, browserAgent} from "./helpers/log.js";

const filter = "nginx-scrapers";

describe("nginx-scrapers", () => {

	it("captures the client IP", () => {
		expect(capturedHost(filter, accessLog({ip: "203.0.113.7", agent: "curl/8.5.0"}))).toBe("203.0.113.7");
	});

	it("matches a request with no user agent at all", () => {
		expectMatch(filter, accessLog({agent: "-"}));
	});

	// A bare product token with nothing after it is not a real browser
	describe("matches a truncated Mozilla token", () => {
		for (const agent of ["Mozilla/4.0", "Mozilla/5.0"]) {
			it(agent, () => {
				expectMatch(filter, accessLog({agent}));
			});
		}
	});

	describe("matches generic client and library user agents", () => {
		const agents = [
			"curl/8.5.0",
			"python-requests/2.31.0",
			"PostmanRuntime/7.36.0",
			"okhttp/4.12.0",
			"node-fetch",
			"Go-http-client/1.1",
			"Java/17.0.1",
			"axios/1.6.7",
			"Deno/1.40.2",
			"bun/1.0.25",
			"cpp-httplib/0.14",
			"CakePHP",
			"jsdom/24.0.0",
			"HeadlessChrome/120.0.0.0",
			"PowerShell/7.4.1",
			"CyotekHTTP/6.1",
			"CyotekWebCopy/1.9",
			"Grabber/1.0",
			"photon/1.0",
			"grub/1.0",
			"moblie/1.0",
			"amazon-kendra-customer-id/1.0"
		];
		for (const agent of agents) {
			it(agent, () => {
				expectMatch(filter, accessLog({agent}));
			});
		}
	});

	describe("ignores genuine browsers", () => {
		const agents = {
			"Chrome on Windows": browserAgent,
			"Safari on macOS": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
			"Firefox on Windows": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
			"Safari on iPhone": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
			"Chrome on Android": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
			"Edge on Windows": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
			"Googlebot": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			"Bingbot": "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"
		};
		for (const [name, agent] of Object.entries(agents)) {
			it(name, () => {
				expectNoMatch(filter, accessLog({agent}));
			});
		}
	});

	// Browsers request these two on any page load, and a generic or absent agent on them is not worth
	// banning over
	describe("ignores excluded paths whatever the user agent", () => {
		for (const path of ["/favicon.ico", "/manifest.json"]) {
			it(path, () => {
				expectNoMatch(filter, accessLog({path, agent: "-"}));
			});
		}
	});

	describe("ignores methods outside the listed set", () => {
		for (const method of ["HEAD", "OPTIONS"]) {
			it(method, () => {
				expectNoMatch(filter, accessLog({method, agent: "curl/8.5.0"}));
			});
		}
	});

	// The keyword alternation is case sensitive, so these tools identify themselves in a casing the
	// filter does not currently cover. Pinned as the current behaviour rather than the desired one
	describe("does not currently match these tools, whose real user agent differs in case", () => {
		const agents = [
			"Wget/1.21.4",
			"Python-urllib/3.11",
			"Ruby",
			"Scrapy/2.11.0 (+https://scrapy.org)"
		];
		for (const agent of agents) {
			it(agent, () => {
				expectNoMatch(filter, accessLog({agent}));
			});
		}
	});
});
