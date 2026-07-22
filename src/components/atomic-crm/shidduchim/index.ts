import React from "react";

const ShidduchimList = React.lazy(() => import("./ShidduchimList"));

export default {
  list: ShidduchimList,
};
