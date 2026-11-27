/**
 * @pk/permissions: Permission modes, allow and deny rules, the always ask list, and a pure decision function.
 *
 * #6 (spec 0005) ships the seam: `decide` allows `read` kind tools and tools allowed for the session,
 * and asks for everything else. Modes and rules arrive with #7 and #10.
 */

/** The pure decision the loop calls before every tool run, and its request, state and result types. */
export {
	decide,
	type PermissionDecision,
	type PermissionRequest,
	type PermissionState,
} from "./decide.ts";
