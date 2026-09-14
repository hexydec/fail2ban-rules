import {describe, it, expect} from "vitest";
import {expectMatch, expectNoMatch, capturedHost} from "./helpers/filter.js";
import {accessLog} from "./helpers/log.js";

const filter = "nginx-excessive-post";

describe("nginx-excessive-post", () => {

	it("captures the client IP", () => {
		expect(capturedHost(filter, accessLog({ip: "203.0.113.7", method: "POST", path: "/contact"}))).toBe("203.0.113.7");
	});

	describe("matches write methods", () => {
		for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
			it(method, () => {
				expectMatch(filter, accessLog({method, path: "/contact"}));
			});
		}
	});

	describe("ignores read methods", () => {
		for (const method of ["GET", "HEAD", "OPTIONS"]) {
			it(method, () => {
				expectNoMatch(filter, accessLog({method, path: "/contact"}));
			});
		}
	});

	// This filter counts requests rather than failures, so the response status is irrelevant
	describe("matches regardless of the response status", () => {
		for (const status of [200, 201, 204, 302, 400, 403, 404, 500]) {
			it(`${status}`, () => {
				expectMatch(filter, accessLog({method: "POST", path: "/contact", status}));
			});
		}
	});

	it("matches a POST to the site root", () => {
		expectMatch(filter, accessLog({method: "POST", path: "/"}));
	});

	// Genuine editors and administrators legitimately generate a lot of writes, so the admin areas of
	// the common content management systems are excluded from the count
	describe("ignores writes to a content management system admin area", () => {
		const paths = [
			"/admin",
			"/admin/pages/edit",
			"/administrator/index.php",
			"/wp-admin/admin-ajax.php",
			"/typo3/index.php",
			"/magento/admin",
			"/cmspages/save",
			"/cmsdesk/publish"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({method: "POST", path}));
			});
		}
	});

	// The exclusions are plain prefixes with no trailing boundary, so any path beginning with one of
	// those words is excluded. Pinned here so a change to that behaviour is visible
	describe("ignores paths that merely begin with an excluded word", () => {
		for (const path of ["/administer/users", "/adminish", "/typo3something"]) {
			it(path, () => {
				expectNoMatch(filter, accessLog({method: "POST", path}));
			});
		}
	});

	// The exclusions are anchored to the first path segment, so an admin area mounted deeper, or one
	// reached via a redirect prefix, is still counted
	describe("matches writes to an excluded word that is not the first path segment", () => {
		for (const path of ["/site/admin/save", "/en/wp-admin/admin-ajax.php"]) {
			it(path, () => {
				expectMatch(filter, accessLog({method: "POST", path}));
			});
		}
	});
});
