import { describe, expect, it, vi } from "vitest";
import { forAccount, ScopedAccountError } from "./forAccount";

const eq = vi.fn().mockReturnThis();
const select = vi.fn().mockReturnThis();
const insert = vi.fn().mockReturnThis();
const update = vi.fn().mockReturnThis();
const del = vi.fn().mockReturnThis();
const upsert = vi.fn().mockReturnThis();
const from = vi.fn(() => ({
  select,
  insert,
  update,
  delete: del,
  upsert,
  eq,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from }),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  SUPABASE_PUBLISHABLE_KEY: "publishable-key",
  RESEND_API_KEY: "re_test",
  RESEND_FROM: "test@example.com",
  APP_ORIGIN: "https://app.example.com",
};

describe("forAccount", () => {
  it("throws when accountId is empty", () => {
    // Arrange / Act / Assert
    expect(() => forAccount("", env)).toThrow(ScopedAccountError);
  });

  it("scopes select() to the account_id predicate", () => {
    // Arrange
    const client = forAccount("acct_1", env);

    // Act
    client.from("candidates").select("id, name");

    // Assert
    expect(from).toHaveBeenCalledWith("candidates");
    expect(select).toHaveBeenCalledWith("id, name");
    expect(eq).toHaveBeenCalledWith("account_id", "acct_1");
  });

  it("injects account_id into every row on insert()", () => {
    // Arrange
    const client = forAccount("acct_1", env);

    // Act
    client.from("candidates").insert([{ name: "Dana" }, { name: "Yael" }]);

    // Assert
    expect(insert).toHaveBeenCalledWith([
      { name: "Dana", account_id: "acct_1" },
      { name: "Yael", account_id: "acct_1" },
    ]);
  });

  it("scopes update() to the account_id predicate", () => {
    // Arrange
    const client = forAccount("acct_1", env);

    // Act
    client.from("candidates").update({ name: "Dana" });

    // Assert
    expect(update).toHaveBeenCalledWith({ name: "Dana" });
    expect(eq).toHaveBeenCalledWith("account_id", "acct_1");
  });

  it("scopes delete() to the account_id predicate", () => {
    // Arrange
    const client = forAccount("acct_1", env);

    // Act
    client.from("candidates").delete();

    // Assert
    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("account_id", "acct_1");
  });

  it("injects account_id into every row on upsert()", () => {
    // Arrange
    const client = forAccount("acct_1", env);

    // Act
    client
      .from("subscription")
      .upsert(
        [{ stripe_customer_id: "cus_1" }, { stripe_customer_id: "cus_2" }],
        { onConflict: "account_id" },
      );

    // Assert
    expect(upsert).toHaveBeenCalledWith(
      [
        { stripe_customer_id: "cus_1", account_id: "acct_1" },
        { stripe_customer_id: "cus_2", account_id: "acct_1" },
      ],
      { onConflict: "account_id" },
    );
  });

  it("cannot have its account_id overridden by the caller's payload on upsert()", () => {
    // Arrange
    const client = forAccount("acct_1", env);

    // Act
    client
      .from("subscription")
      .upsert(
        { account_id: "acct_attacker", plan: "ai" },
        { onConflict: "account_id" },
      );

    // Assert
    expect(upsert).toHaveBeenCalledWith(
      [{ account_id: "acct_1", plan: "ai" }],
      { onConflict: "account_id" },
    );
  });
});
