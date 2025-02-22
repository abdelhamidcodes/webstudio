import { expect, test } from "@jest/globals";
import { cleanStores } from "nanostores";
import type { Instance, Page } from "@webstudio-is/sdk";
import { collectionComponent } from "@webstudio-is/react-sdk";
import { $instances } from "./instances";
import {
  $propValuesByInstanceSelector,
  $variableValuesByInstanceSelector,
} from "./props";
import { $pages, $selectedPageId } from "./pages";
import {
  $assets,
  $dataSourceVariables,
  $dataSources,
  $props,
  $resourceValues,
} from "./nano-states";
import { $params } from "~/canvas/stores";

const getIdValuePair = <T extends { id: string }>(item: T) =>
  [item.id, item] as const;

const toMap = <T extends { id: string }>(list: T[]) =>
  new Map(list.map(getIdValuePair));

const setBoxInstance = (id: Instance["id"]) => {
  $instances.set(
    toMap([{ id, type: "instance", component: "Box", children: [] }])
  );
};

const selectPageRoot = (rootInstanceId: Instance["id"]) => {
  $pages.set({
    homePage: { id: "pageId", rootInstanceId, path: "/my-page" } as Page,
    pages: [],
  });
  $selectedPageId.set("pageId");
};

test("collect prop values", () => {
  setBoxInstance("box");
  selectPageRoot("box");
  $dataSources.set(new Map());
  $props.set(
    toMap([
      {
        id: "prop1",
        name: "first",
        instanceId: "box",
        type: "number",
        value: 0,
      },
      {
        id: "prop2",
        name: "second",
        instanceId: "box",
        type: "json",
        value: { name: "John" },
      },
    ])
  );
  expect(
    $propValuesByInstanceSelector.get().get(JSON.stringify(["box"]))
  ).toEqual(
    new Map<string, unknown>([
      ["first", 0],
      ["second", { name: "John" }],
    ])
  );

  cleanStores($propValuesByInstanceSelector);
});

test("compute expression prop values", () => {
  setBoxInstance("box");
  selectPageRoot("box");
  $dataSources.set(
    toMap([
      {
        id: "var1",
        type: "variable",
        name: "",
        value: { type: "number", value: 1 },
      },
      {
        id: "var2",
        type: "variable",
        name: "",
        value: { type: "string", value: "Hello" },
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "prop1",
        name: "first",
        instanceId: "box",
        type: "expression",
        value: `$ws$dataSource$var1 + 2`,
      },
      {
        id: "prop2",
        name: "second",
        instanceId: "box",
        type: "expression",
        value: `$ws$dataSource$var2 + ' World!'`,
      },
    ])
  );
  expect(
    $propValuesByInstanceSelector.get().get(JSON.stringify(["box"]))
  ).toEqual(
    new Map<string, unknown>([
      ["first", 3],
      ["second", "Hello World!"],
    ])
  );

  $dataSourceVariables.set(new Map([["var1", 4]]));
  expect(
    $propValuesByInstanceSelector.get().get(JSON.stringify(["box"]))
  ).toEqual(
    new Map<string, unknown>([
      ["first", 6],
      ["second", "Hello World!"],
    ])
  );

  cleanStores($propValuesByInstanceSelector);
});

test("generate action prop callbacks", () => {
  setBoxInstance("box");
  selectPageRoot("box");
  $dataSources.set(
    toMap([
      {
        id: "var",
        type: "variable",
        name: "",
        value: { type: "number", value: 1 },
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "valueId",
        name: "value",
        instanceId: "box",
        type: "expression",
        value: `$ws$dataSource$var`,
      },
      {
        id: "actionId",
        name: "onChange",
        instanceId: "box",
        type: "action",
        value: [
          {
            type: "execute",
            args: [],
            code: `$ws$dataSource$var = $ws$dataSource$var + 1`,
          },
        ],
      },
    ])
  );
  const values1 = $propValuesByInstanceSelector
    .get()
    .get(JSON.stringify(["box"]));
  expect(values1?.get("value")).toEqual(1);

  (values1?.get("onChange") as () => void)();
  const values2 = $propValuesByInstanceSelector
    .get()
    .get(JSON.stringify(["box"]));
  expect(values2?.get("value")).toEqual(2);

  cleanStores($propValuesByInstanceSelector);
});

test("resolve asset prop values when params is provided", () => {
  setBoxInstance("box");
  selectPageRoot("box");
  $dataSources.set(new Map());
  $params.set(undefined);
  $assets.set(
    toMap([
      {
        id: "assetId",
        type: "image",
        name: "my-file.jpg",
        format: "jpeg",
        size: 0,
        projectId: "",
        createdAt: "",
        meta: { width: 0, height: 0 },
        description: "",
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "propId",
        name: "myAsset",
        instanceId: "box",
        type: "asset",
        value: "assetId",
      },
    ])
  );
  expect(
    $propValuesByInstanceSelector.get().get(JSON.stringify(["box"]))
  ).toEqual(new Map());

  $params.set({
    assetBaseUrl: "/asset/",
    imageBaseUrl: "/image/",
  });
  expect(
    $propValuesByInstanceSelector.get().get(JSON.stringify(["box"]))
  ).toEqual(new Map<string, unknown>([["myAsset", "/asset/my-file.jpg"]]));

  cleanStores($propValuesByInstanceSelector);
});

test("resolve page prop values when params is provided", () => {
  setBoxInstance("box");
  selectPageRoot("box");
  $params.set(undefined);
  $dataSources.set(new Map());
  $props.set(
    toMap([
      {
        id: "propId",
        name: "myPage",
        instanceId: "box",
        type: "page",
        value: "pageId",
      },
    ])
  );
  expect(
    $propValuesByInstanceSelector.get().get(JSON.stringify(["box"]))
  ).toEqual(new Map());

  $params.set({
    assetBaseUrl: "/asset/",
    imageBaseUrl: "/image/",
  });
  expect(
    $propValuesByInstanceSelector.get().get(JSON.stringify(["box"]))
  ).toEqual(new Map<string, unknown>([["myPage", "/my-page"]]));

  cleanStores($propValuesByInstanceSelector);
});

test("compute expression from collection items", () => {
  $instances.set(
    toMap([
      {
        id: "list",
        type: "instance",
        component: collectionComponent,
        children: [{ type: "id", value: "item" }],
      },
      {
        id: "item",
        type: "instance",
        component: "Box",
        children: [],
      },
    ])
  );
  selectPageRoot("list");
  $dataSources.set(
    toMap([
      {
        id: "itemId",
        type: "parameter",
        name: "item",
      },
    ])
  );
  $props.set(
    toMap([
      {
        id: "prop1",
        name: "data",
        instanceId: "list",
        type: "json",
        value: ["orange", "apple", "banana"],
      },
      {
        id: "prop2",
        name: "item",
        instanceId: "list",
        type: "parameter",
        value: "itemId",
      },
      {
        id: "prop3",
        name: "ariaLabel",
        instanceId: "item",
        type: "expression",
        value: `$ws$dataSource$itemId`,
      },
    ])
  );
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        JSON.stringify(["list"]),
        new Map<string, unknown>([["data", ["orange", "apple", "banana"]]]),
      ],
      [
        JSON.stringify(["item", "list[0]", "list"]),
        new Map<string, unknown>([["ariaLabel", "orange"]]),
      ],
      [
        JSON.stringify(["item", "list[1]", "list"]),
        new Map<string, unknown>([["ariaLabel", "apple"]]),
      ],
      [
        JSON.stringify(["item", "list[2]", "list"]),
        new Map<string, unknown>([["ariaLabel", "banana"]]),
      ],
    ])
  );

  cleanStores($propValuesByInstanceSelector);
});

test("access parameter value from variables values", () => {
  $instances.set(
    toMap([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [],
      },
    ])
  );
  selectPageRoot("body");
  $dataSources.set(
    toMap([
      {
        id: "parameterId",
        type: "parameter",
        name: "paramName",
      },
    ])
  );
  $dataSourceVariables.set(new Map([["parameterId", "paramValue"]]));
  $props.set(
    toMap([
      {
        id: "parameterPropId",
        name: "param",
        instanceId: "body",
        type: "expression",
        value: "$ws$dataSource$parameterId",
      },
    ])
  );
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        JSON.stringify(["body"]),
        new Map<string, unknown>([["param", "paramValue"]]),
      ],
    ])
  );

  cleanStores($propValuesByInstanceSelector);
});

test("compute props bound to resource variables", () => {
  $instances.set(
    toMap([{ id: "body", type: "instance", component: "Body", children: [] }])
  );
  selectPageRoot("body");
  $dataSources.set(
    toMap([
      {
        id: "resourceVariableId",
        type: "resource",
        name: "paramName",
        resourceId: "resourceId",
      },
    ])
  );
  $resourceValues.set(new Map([["resourceId", "my-value"]]));
  $props.set(
    toMap([
      {
        id: "resourcePropId",
        name: "resource",
        instanceId: "body",
        type: "expression",
        value: "$ws$dataSource$resourceVariableId",
      },
    ])
  );
  expect($propValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        JSON.stringify(["body"]),
        new Map<string, unknown>([["resource", "my-value"]]),
      ],
    ])
  );

  cleanStores($propValuesByInstanceSelector);
});

test("compute variable values for root", () => {
  $instances.set(
    toMap([{ id: "body", type: "instance", component: "Body", children: [] }])
  );
  selectPageRoot("body");
  $dataSources.set(
    toMap([
      {
        id: "variableId",
        scopeInstanceId: "body",
        type: "variable",
        name: "variableName",
        value: { type: "string", value: "initial" },
      },
    ])
  );
  $dataSourceVariables.set(new Map([["variableId", "success"]]));
  $props.set(new Map());

  expect($variableValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        JSON.stringify(["body"]),
        new Map<string, unknown>([["variableId", "success"]]),
      ],
    ])
  );

  cleanStores($variableValuesByInstanceSelector);
});

test("nest variable values from root to current instance", () => {
  $instances.set(
    toMap([
      {
        id: "body",
        type: "instance",
        component: "Body",
        children: [
          { type: "id", value: "box" },
          { type: "id", value: "text" },
        ],
      },
      { id: "box", type: "instance", component: "Box", children: [] },
      { id: "text", type: "instance", component: "Text", children: [] },
    ])
  );
  selectPageRoot("body");
  $dataSources.set(
    toMap([
      {
        id: "bodyVariableId",
        scopeInstanceId: "body",
        type: "variable",
        name: "bodyVariable",
        value: { type: "string", value: "" },
      },
      {
        id: "boxVariableId",
        scopeInstanceId: "box",
        type: "variable",
        name: "boxVariable",
        value: { type: "string", value: "" },
      },
      {
        id: "textVariableId",
        scopeInstanceId: "text",
        type: "variable",
        name: "textVariable",
        value: { type: "string", value: "" },
      },
    ])
  );
  $dataSourceVariables.set(
    new Map([
      ["bodyVariableId", "bodyValue"],
      ["boxVariableId", "boxValue"],
      ["textVariableId", "textValue"],
    ])
  );
  $props.set(new Map());

  expect($variableValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        JSON.stringify(["body"]),
        new Map<string, unknown>([["bodyVariableId", "bodyValue"]]),
      ],
      [
        JSON.stringify(["box", "body"]),
        new Map<string, unknown>([
          ["bodyVariableId", "bodyValue"],
          ["boxVariableId", "boxValue"],
        ]),
      ],
      [
        JSON.stringify(["text", "body"]),
        new Map<string, unknown>([
          ["bodyVariableId", "bodyValue"],
          ["textVariableId", "textValue"],
        ]),
      ],
    ])
  );

  cleanStores($variableValuesByInstanceSelector);
});

test("compute item values for collection", () => {
  $instances.set(
    toMap([
      {
        id: "collection",
        type: "instance",
        component: collectionComponent,
        children: [{ type: "id", value: "box" }],
      },
      { id: "box", type: "instance", component: "Box", children: [] },
    ])
  );
  selectPageRoot("collection");
  $dataSources.set(
    toMap([
      {
        id: "dataId",
        scopeInstanceId: "collection",
        type: "variable",
        name: "collectionItem",
        value: { type: "json", value: ["apple", "banana", "orange"] },
      },
      {
        id: "itemId",
        scopeInstanceId: "collection",
        type: "parameter",
        name: "collectionItem",
      },
    ])
  );
  $dataSourceVariables.set(new Map([]));
  $props.set(
    toMap([
      {
        id: "dataPropId",
        instanceId: "collection",
        name: "data",
        type: "expression",
        value: "$ws$dataSource$dataId",
      },
      {
        id: "itemPropId",
        instanceId: "collection",
        name: "item",
        type: "parameter",
        value: "itemId",
      },
    ])
  );

  expect($variableValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        JSON.stringify(["box", "collection[0]", "collection"]),
        new Map<string, unknown>([
          ["dataId", ["apple", "banana", "orange"]],
          ["itemId", "apple"],
        ]),
      ],
      [
        JSON.stringify(["box", "collection[1]", "collection"]),
        new Map<string, unknown>([
          ["dataId", ["apple", "banana", "orange"]],
          ["itemId", "banana"],
        ]),
      ],
      [
        JSON.stringify(["box", "collection[2]", "collection"]),
        new Map<string, unknown>([
          ["dataId", ["apple", "banana", "orange"]],
          ["itemId", "orange"],
        ]),
      ],
      [
        JSON.stringify(["collection"]),
        new Map<string, unknown>([["dataId", ["apple", "banana", "orange"]]]),
      ],
    ])
  );

  cleanStores($variableValuesByInstanceSelector);
});

test("compute resource variable values", () => {
  $instances.set(
    toMap([{ id: "body", type: "instance", component: "Body", children: [] }])
  );
  selectPageRoot("body");
  $dataSources.set(
    toMap([
      {
        id: "resourceVariableId",
        scopeInstanceId: "body",
        type: "resource",
        name: "variableName",
        resourceId: "resourceId",
      },
    ])
  );
  $resourceValues.set(new Map([["resourceId", "my-value"]]));
  $props.set(new Map());

  expect($variableValuesByInstanceSelector.get()).toEqual(
    new Map([
      [
        JSON.stringify(["body"]),
        new Map<string, unknown>([["resourceVariableId", "my-value"]]),
      ],
    ])
  );

  cleanStores($variableValuesByInstanceSelector);
});
