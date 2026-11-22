import type { DataProvider } from "ra-core";
import { transformFilter } from "./transformFilter";

function removeSummarySuffix(resource: string) {
  return resource.endsWith("_summary")
    ? resource.replace("_summary", "")
    : resource;
}

function readResource(resource: string): string {
  // entity_files_summary is emulated by the custom provider. Preserve its
  // name so that getList/getOne can apply the view's deleted_at filter before
  // the generic suffix adapter sees the request.
  return resource === "entity_files_summary"
    ? resource
    : removeSummarySuffix(resource);
}

export function withSupabaseFilterAdapter<T extends DataProvider>(
  dataProvider: T,
): T {
  return {
    ...dataProvider,
    getOne(resource, params) {
      return dataProvider.getOne(readResource(resource), params);
    },
    getList(resource, params) {
      return dataProvider.getList(readResource(resource), {
        ...params,
        filter: transformFilter(params.filter),
      });
    },
    getMany(resource, params) {
      return dataProvider.getMany(removeSummarySuffix(resource), params);
    },
    getManyReference(resource, params) {
      return dataProvider.getManyReference(removeSummarySuffix(resource), {
        ...params,
        filter: transformFilter(params.filter),
      });
    },
    create(resource, params) {
      return dataProvider.create(removeSummarySuffix(resource), params);
    },
    delete(resource, params) {
      return dataProvider.delete(removeSummarySuffix(resource), params);
    },
    deleteMany(resource, params) {
      return dataProvider.deleteMany(removeSummarySuffix(resource), params);
    },
    update(resource, params) {
      return dataProvider.update(removeSummarySuffix(resource), params);
    },
    updateMany(resource, params) {
      return dataProvider.updateMany(removeSummarySuffix(resource), params);
    },
  };
}
