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

	// The block editor saves, autosaves and uploads through the core REST API rather than wp-admin, and
	// its write routes refuse a client that is not logged in, so they are excluded alongside the admin areas
	describe("ignores writes to the WordPress core REST API", () => {
		const paths = [
			"/wp-json/wp/v2/posts/123",
			"/wp-json/wp/v2/posts/123/autosaves",
			"/wp-json/wp/v2/media",
			"/wp-json/batch/v1",
			"/wp-json/batch/v1?_locale=user",
			"/?rest_route=/wp/v2/posts/123",
			"/index.php?rest_route=/wp/v2/media",
			"/index.php?rest_route=%2Fwp%2Fv2%2Fmedia",
			"/?rest_route=/batch/v1&_locale=user"
		];
		for (const path of paths) {
			it(path, () => {
				expectNoMatch(filter, accessLog({method: "POST", path}));
			});
		}
	});

	// Plugin namespaces and the login and comment forms take writes from anyone, so they are still counted
	describe("matches WordPress writes outside the core REST API", () => {
		const paths = [
			"/wp-login.php",
			"/wp-comments-post.php",
			"/wp-json/contact-form-7/v1/contact-forms/5/feedback",
			"/?rest_route=/contact-form-7/v1/contact-forms/5/feedback",
			"/wp-json/wp/v2x/posts",
			"/wp-json/batch/v10",
			"/?rest_route=/wp/v2x/posts",
			"/en/wp-json/wp/v2/posts/123"
		];
		for (const path of paths) {
			it(path, () => {
				expectMatch(filter, accessLog({method: "POST", path}));
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
