import { describe, expect, it } from "vitest";
import { englishCrmMessages } from "../commons/englishCrmMessages";
import {
  AGE_RESTRICTION_MESSAGE_KEY,
  readOAuthCallbackError,
  SIGNUP_AGE_REJECTION_MESSAGE,
} from "./oauthCallback";

describe("readOAuthCallbackError", () => {
  it("returns null when the URL carries no error at all", () => {
    // Arrange
    const location = { search: "", hash: "#/auth-callback" };

    // Act
    const result = readOAuthCallbackError(location);

    // Assert
    expect(result).toBeNull();
  });

  it("reads a query-string error (PKCE-style redirect)", () => {
    // Arrange
    const location = {
      search: "?error=access_denied&error_description=Cancelled",
      hash: "",
    };

    // Act
    const result = readOAuthCallbackError(location);

    // Assert
    expect(result?.messageKey).toBe("crm.auth.oauth_callback.cancelled");
  });

  it("reads an error appended to the auth-callback hash route", () => {
    // Arrange
    const location = {
      search: "",
      hash: "#/auth-callback&error=access_denied&error_description=User+cancelled",
    };

    // Act
    const result = readOAuthCallbackError(location);

    // Assert
    expect(result?.messageKey).toBe("crm.auth.oauth_callback.cancelled");
  });

  it("maps access_denied to the calm cancelled message", () => {
    // Arrange
    const location = { search: "?error=access_denied", hash: "" };

    // Act
    const result = readOAuthCallbackError(location);

    // Assert
    expect(result?.messageKey).toBe("crm.auth.oauth_callback.cancelled");
  });

  it("maps a disabled-provider description to the not-configured message", () => {
    // Arrange
    const location = {
      search:
        "?error=server_error&error_description=Unsupported+provider%3A+provider+is+not+enabled",
      hash: "",
    };

    // Act
    const result = readOAuthCallbackError(location);

    // Assert
    expect(result?.messageKey).toBe("crm.auth.oauth_callback.not_configured");
  });

  it("maps an unmarked age rejection to a stable catalogue message", () => {
    // Arrange
    const ageMessage =
      "You must confirm you are 18 years of age or older to sign up.";
    const location = {
      search: `?error=server_error&error_description=${encodeURIComponent(ageMessage)}`,
      hash: "",
    };

    // Act
    const result = readOAuthCallbackError(location);

    // Assert
    expect(result?.messageKey).toBe(AGE_RESTRICTION_MESSAGE_KEY);
    expect(result?.defaultMessage).toBe(
      "You must be 18 years of age or older to create an account.",
    );
  });

  it("maps a marked returning-user age rejection to account creation recovery", () => {
    // Arrange
    const location = {
      search: `?auth_flow=sign-in&error=server_error&error_description=${encodeURIComponent(
        SIGNUP_AGE_REJECTION_MESSAGE,
      )}`,
      hash: "#/auth-callback",
    };

    // Act
    const result = readOAuthCallbackError(location, "sign-in");

    // Assert: the sign-up page still receives the age message, while the
    // returning-user Google path gets the no-account recovery choice.
    expect(result?.messageKey).toBe("crm.auth.oauth_callback.no_account");
    expect(result?.defaultMessage).toBe(
      "No account has been found. Would you like to create a new account?",
    );
  });

  it("falls back to the generic calm message for an unrecognized cause", () => {
    // Arrange
    const location = {
      search: "?error=server_error&error_description=Something+odd+happened",
      hash: "",
    };

    // Act
    const result = readOAuthCallbackError(location);

    // Assert
    expect(result?.messageKey).toBe("crm.auth.oauth_callback.generic");
  });

  it("does not call an unrelated age-related provider error no-account recovery", () => {
    // Arrange
    const location = {
      search: `?error=server_error&error_description=${encodeURIComponent(
        "You must be 18 years of age to use this provider.",
      )}`,
      hash: "#/auth-callback",
    };

    // Act
    const result = readOAuthCallbackError(location, "sign-in");

    // Assert
    expect(result?.messageKey).toBe("crm.auth.oauth_callback.generic");
  });

  it("prefers the query string over the hash when both are present", () => {
    // Arrange
    const location = {
      search: "?error=access_denied",
      hash: "#/auth-callback&error=server_error&error_description=Unsupported+provider",
    };

    // Act
    const result = readOAuthCallbackError(location);

    // Assert: the query string's access_denied wins, not the hash's error.
    expect(result?.messageKey).toBe("crm.auth.oauth_callback.cancelled");
  });
});

// AuthCallback (components/admin/authentication.tsx) renders a rejected
// handleCallback() as `translate(error.message, { _: error.message })` —
// note the fallback there is the RAW KEY, not this module's own
// `defaultMessage`. So the friendly text a turned-away visitor actually sees
// comes entirely from the catalogue entry, and a catalogue drifting from
// (or missing) what mapOAuthCallbackError intends would silently show the
// bare key string ("crm.auth.oauth_callback.cancelled") instead of a real
// sentence. These guard that drift directly, for both known-cause messages.
describe("crm.auth.oauth_callback.* catalogue entries", () => {
  const cases: Array<{
    label: string;
    location: { search: string; hash: string };
  }> = [
    {
      label: "cancelled",
      location: { search: "?error=access_denied", hash: "" },
    },
    {
      label: "not_configured",
      location: {
        search:
          "?error=server_error&error_description=Unsupported+provider%3A+provider+is+not+enabled",
        hash: "",
      },
    },
    {
      label: "generic",
      location: {
        search: "?error=server_error&error_description=Something+odd",
        hash: "",
      },
    },
    {
      label: "no_account",
      location: {
        search:
          "?auth_flow=sign-in&error=server_error&error_description=You+must+confirm+you+are+18+years+of+age+or+older+to+sign+up.",
        hash: "#/auth-callback",
      },
    },
    {
      label: "age_restricted",
      location: {
        search:
          "?error=server_error&error_description=You+must+confirm+you+are+18+years+of+age+or+older+to+sign+up.",
        hash: "#/auth-callback",
      },
    },
  ];

  it.each(cases)(
    "$label: the English catalogue entry is exactly what mapOAuthCallbackError intends",
    ({ location }) => {
      // Arrange
      const result = readOAuthCallbackError(location);
      if (!result) {
        throw new Error("expected a mapped OAuth callback error");
      }

      // Act
      const catalogueKey = result.messageKey.replace(
        "crm.auth.oauth_callback.",
        "",
      );
      const catalogueText =
        englishCrmMessages.crm.auth.oauth_callback[
          catalogueKey as keyof typeof englishCrmMessages.crm.auth.oauth_callback
        ];

      // Assert
      expect(catalogueText).toBe(result.defaultMessage);
    },
  );
});
