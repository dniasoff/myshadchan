export type PurgeRequestUrl = {
  pathname: string;
  search: string;
  hash: string;
};

export const isPurgeRequestUrl = (url: PurgeRequestUrl): boolean => {
  return (
    url.pathname === "/purge-request" && url.search === "" && url.hash === ""
  );
};
