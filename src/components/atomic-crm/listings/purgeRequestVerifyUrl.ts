export type PurgeRequestVerifyUrl = {
  pathname: string;
  search: string;
  hash: string;
};

export const isPurgeRequestVerifyUrl = (
  url: PurgeRequestVerifyUrl,
): boolean => {
  return (
    url.pathname === "/purge-request-verify" &&
    url.search === "" &&
    url.hash === ""
  );
};
