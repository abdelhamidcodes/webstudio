import { z } from "zod";
import {
  type ComponentProps,
  type FocusEventHandler,
  useState,
  useCallback,
  Fragment,
} from "react";
import { useStore } from "@nanostores/react";
import { useDebouncedCallback } from "use-debounce";
import { useUnmount } from "react-use";
import slugify from "slugify";
import { isFeatureEnabled } from "@webstudio-is/feature-flags";
import {
  type Page,
  type Pages,
  PageName,
  HomePagePath,
  PageTitle,
  PagePath,
  DataSource,
} from "@webstudio-is/sdk";
import { findPageByIdOrPath } from "@webstudio-is/project-build";
import {
  theme,
  Button,
  Box,
  Label,
  TextArea,
  InputErrorsTooltip,
  Tooltip,
  InputField,
  Grid,
  Checkbox,
  Separator,
  Text,
  ScrollArea,
  rawTheme,
  Flex,
} from "@webstudio-is/design-system";
import {
  ChevronDoubleLeftIcon,
  CopyIcon,
  TrashIcon,
  CheckMarkIcon,
  LinkIcon,
  HomeIcon,
  HelpIcon,
} from "@webstudio-is/icons";
import { useIds } from "~/shared/form-utils";
import { Header, HeaderSuffixSpacer } from "../../header";
import {
  deleteInstance,
  getInstancesSlice,
  insertInstancesSliceCopy,
} from "~/shared/instance-utils";
import {
  assetsStore,
  $domains,
  instancesStore,
  pagesStore,
  projectStore,
  selectedInstanceSelectorStore,
  selectedPageIdStore,
  $dataSources,
  $dataSourceVariables,
} from "~/shared/nano-states";
import { nanoid } from "nanoid";
import { removeByMutable } from "~/shared/array-utils";
import { serverSyncStore } from "~/shared/sync";
import { SearchPreview } from "./search-preview";
import { ImageControl } from "~/builder/features/seo/image-control";
import { ImageInfo } from "./image-info";
import { SocialPreview } from "./social-preview";
import { useEffectEvent } from "~/builder/features/ai/hooks/effect-event";
import { CustomMetadata } from "./custom-metadata";
import env from "~/shared/env";
import {
  compilePathnamePattern,
  parsePathnamePattern,
  validatePathnamePattern,
} from "./url-pattern";

const fieldDefaultValues = {
  name: "Untitled",
  path: "/untitled",
  title: "Untitled",
  description: "",
  isHomePage: false,
  excludePageFromSearch: false,
  socialImageAssetId: "",
  customMetas: [
    {
      property: "",
      content: "",
    },
  ],
};

const fieldNames = Object.keys(
  fieldDefaultValues
) as (keyof typeof fieldDefaultValues)[];

type FieldName = (typeof fieldNames)[number];

type Values = typeof fieldDefaultValues;

type Errors = {
  [fieldName in FieldName]?: string[];
};

const LegacyPagePath = z
  .string()
  .refine((path) => path !== "", "Can't be empty")
  .refine((path) => path !== "/", "Can't be just a /")
  .refine((path) => path === "" || path.startsWith("/"), "Must start with a /")
  .refine((path) => path.endsWith("/") === false, "Can't end with a /")
  .refine((path) => path.includes("//") === false, "Can't contain repeating /")
  .refine(
    (path) => /^[-_a-z0-9\\/]*$/.test(path),
    "Only a-z, 0-9, -, _, / are allowed"
  )
  .refine(
    // We use /s for our system stuff like /s/css or /s/uploads
    (path) => path !== "/s" && path.startsWith("/s/") === false,
    "/s prefix is reserved for the system"
  )
  .refine(
    // Remix serves build artefacts like JS bundles from /build
    // And we cannot customize it due to bug in Remix: https://github.com/remix-run/remix/issues/2933
    (path) => path !== "/build" && path.startsWith("/build/") === false,
    "/build prefix is reserved for the system"
  );

const HomePageValues = z.object({
  name: PageName,
  path: HomePagePath,
  title: PageTitle,
  description: z.string().optional(),
});

const PageValues = z.object({
  name: PageName,
  path: isFeatureEnabled("bindings") ? PagePath : LegacyPagePath,
  title: PageTitle,
  description: z.string().optional(),
});

const isPathUnique = (
  pages: Pages,
  // undefined page id means new page
  pageId: undefined | Page["id"],
  path: string
) => {
  const list = [];
  const set = new Set();
  list.push(path);
  set.add(path);
  for (const page of pages.pages) {
    if (page.id !== pageId) {
      list.push(page.path);
      set.add(page.path);
    }
  }
  return list.length === set.size;
};

const validateValues = (
  pages: undefined | Pages,
  // undefined page id means new page
  pageId: undefined | Page["id"],
  values: Values,
  isHomePage: boolean
): Errors => {
  const Validator = isHomePage ? HomePageValues : PageValues;
  const parsedResult = Validator.safeParse(values);
  const errors: Errors = {};
  if (parsedResult.success === false) {
    return parsedResult.error.formErrors.fieldErrors;
  }
  if (pages !== undefined && values.path !== undefined) {
    if (isPathUnique(pages, pageId, values.path) === false) {
      errors.path = errors.path ?? [];
      errors.path.push("All paths must be unique");
    }
    const messages = validatePathnamePattern(values.path);
    if (messages.length > 0) {
      errors.path = errors.path ?? [];
      errors.path.push(...messages);
    }
  }
  return errors;
};

const toFormPage = (page: Page, isHomePage: boolean): Values => {
  return {
    name: page.name,
    path: page.path,
    title: page.title,
    description: page.meta.description ?? fieldDefaultValues.description,
    socialImageAssetId:
      page.meta.socialImageAssetId ?? fieldDefaultValues.socialImageAssetId,
    excludePageFromSearch:
      page.meta.excludePageFromSearch ??
      fieldDefaultValues.excludePageFromSearch,
    isHomePage,
    customMetas: page.meta.custom ?? fieldDefaultValues.customMetas,
  };
};

const autoSelectHandler: FocusEventHandler<HTMLInputElement> = (event) =>
  event.target.select();

const CopyPageDomainAndPathButton = ({
  pageDomainAndPath,
}: {
  pageDomainAndPath: string;
}) => {
  const [pathIconState, setPathIconState] = useState<
    "link" | "copy" | "checkmark"
  >("link");

  let pathIcon = <CopyIcon />;
  if (pathIconState === "checkmark") {
    pathIcon = <CheckMarkIcon />;
  } else if (pathIconState === "link") {
    pathIcon = <LinkIcon />;
  }

  return (
    <Tooltip
      content={pathIconState === "checkmark" ? "Copied" : "Click to copy"}
    >
      <Button
        color="ghost"
        type="button"
        onPointerDown={(event) => {
          navigator.clipboard.writeText(`https://${pageDomainAndPath}`);
          setPathIconState("checkmark");
          // Prevent tooltip to be closed
          event.stopPropagation();
        }}
        // Recreating Icon without pointer-events: none cause mouse leave/enter event to be fired again
        prefix={
          <Grid align="center" css={{ pointerEvents: "none" }}>
            {pathIcon}
          </Grid>
        }
        css={{ justifySelf: "start" }}
        onMouseEnter={() => {
          setPathIconState("copy");
        }}
        onMouseLeave={() => {
          setPathIconState("link");
        }}
      >
        {pageDomainAndPath}
      </Button>
    </Tooltip>
  );
};

const FormFields = ({
  disabled,
  autoSelect,
  pathVariableId,
  errors,
  values,
  onChange,
}: {
  disabled?: boolean;
  autoSelect?: boolean;
  pathVariableId?: DataSource["id"];
  errors: Errors;
  values: Values;
  onChange: (
    event: {
      [K in keyof Values]: {
        field: K;
        value: Values[K];
      };
    }[keyof Values]
  ) => void;
}) => {
  const fieldIds = useIds(fieldNames);
  const assets = useStore(assetsStore);
  const pages = useStore(pagesStore);
  const socialImageAsset = assets.get(values.socialImageAssetId);
  const faviconAsset = assets.get(pages?.meta?.faviconAssetId ?? "");

  const faviconUrl = faviconAsset?.type === "image" ? faviconAsset.name : "";

  const project = projectStore.get();
  const customDomain: string | undefined = $domains.get()[0];
  const projectDomain = `${project?.domain}.${
    env.PUBLISHER_HOST ?? "wstd.work"
  }`;
  const domain = customDomain ?? projectDomain;

  const publishedUrl = new URL(`https://${domain}`);

  const pathParamNames = parsePathnamePattern(values.path);
  const dataSourceVariables = useStore($dataSourceVariables);
  const params =
    pathVariableId !== undefined
      ? (dataSourceVariables.get(pathVariableId) as Record<string, string>)
      : undefined;

  const compiledPath = compilePathnamePattern(values.path ?? "", params ?? {});
  const pageDomainAndPath = [publishedUrl.host, compiledPath]
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
  const pageUrl = `https://${pageDomainAndPath}`;

  const TOPBAR_HEIGHT = 40;
  const HEADER_HEIGHT = 40;
  const FOOTER_HEIGHT = 24;
  const SCROLL_AREA_DELTA = TOPBAR_HEIGHT + HEADER_HEIGHT + FOOTER_HEIGHT;

  return (
    <Grid>
      <ScrollArea css={{ maxHeight: `calc(100vh - ${SCROLL_AREA_DELTA}px)` }}>
        {/**
         * ----------------------========<<<Page props>>>>========----------------------
         */}
        <Grid gap={3} css={{ my: theme.spacing[5], mx: theme.spacing[8] }}>
          <Grid gap={1}>
            <Label htmlFor={fieldIds.name}>Page Name</Label>
            <InputErrorsTooltip errors={errors.name}>
              <InputField
                tabIndex={1}
                color={errors.name && "error"}
                id={fieldIds.name}
                autoFocus
                onFocus={autoSelect ? autoSelectHandler : undefined}
                name="name"
                placeholder="About"
                disabled={disabled}
                value={values.name}
                onChange={(event) => {
                  onChange({ field: "name", value: event.target.value });
                }}
              />
            </InputErrorsTooltip>

            <Grid flow={"column"} gap={1} justify={"start"} align={"center"}>
              {values.isHomePage ? (
                <HomeIcon />
              ) : (
                <Checkbox
                  id={fieldIds.isHomePage}
                  onCheckedChange={() => {
                    onChange({ field: "path", value: "" });
                    onChange({
                      field: "isHomePage",
                      value: !values.isHomePage,
                    });
                  }}
                />
              )}

              <Label
                css={{
                  overflowWrap: "anywhere",
                  wordBreak: "break-all",
                }}
                htmlFor={fieldIds.isHomePage}
              >
                {values.isHomePage
                  ? `“${values.name}” is the home page`
                  : `Make “${values.name}” the home page`}
              </Label>
            </Grid>
            {values.isHomePage === true && (
              <>
                <div />
                <CopyPageDomainAndPathButton
                  pageDomainAndPath={pageDomainAndPath}
                />
              </>
            )}
          </Grid>

          {values.isHomePage === false && (
            <Grid gap={1}>
              <Label htmlFor={fieldIds.path}>
                <Flex align="center" css={{ gap: theme.spacing[3] }}>
                  Path
                  <Tooltip
                    content={
                      "The path can include dynamic parameters like :name, which could be made optional using :name?, or have a wildcard such as /* or /:name* to store whole remaining part at the end of the URL."
                    }
                    variant="wrapped"
                  >
                    <HelpIcon
                      color={rawTheme.colors.foregroundSubtle}
                      tabIndex={0}
                    />
                  </Tooltip>
                </Flex>
              </Label>
              <InputErrorsTooltip errors={errors.path}>
                <InputField
                  tabIndex={1}
                  color={errors.path && "error"}
                  id={fieldIds.path}
                  name="path"
                  placeholder="/about"
                  disabled={disabled}
                  value={values?.path}
                  onChange={(event) => {
                    onChange({ field: "path", value: event.target.value });
                  }}
                />
              </InputErrorsTooltip>
              {pathVariableId !== undefined &&
                pathParamNames.map((name) => (
                  <Fragment key={name}>
                    <Label htmlFor={`${fieldIds.path}-${name}`}>{name}</Label>
                    <InputField
                      tabIndex={1}
                      id={`${fieldIds.path}-${name}`}
                      name="path"
                      value={params?.[name] ?? ""}
                      onChange={(event) => {
                        if (pathVariableId === undefined) {
                          return;
                        }
                        const dataSourceVariables = new Map(
                          $dataSourceVariables.get()
                        );
                        // delete stale fields
                        const newParams: Record<string, string> = {};
                        for (const name of pathParamNames) {
                          if (params?.[name]) {
                            newParams[name] = params[name];
                          }
                        }
                        newParams[name] = event.target.value;
                        dataSourceVariables.set(pathVariableId, newParams);
                        $dataSourceVariables.set(dataSourceVariables);
                      }}
                    />
                  </Fragment>
                ))}
              <CopyPageDomainAndPathButton
                pageDomainAndPath={pageDomainAndPath}
              />
            </Grid>
          )}
        </Grid>

        <Separator />

        {/**
         * ----------------------========<<<Search Results>>>>========----------------------
         */}
        <Grid gap={2} css={{ my: theme.spacing[5], mx: theme.spacing[8] }}>
          <Grid gap={2}>
            <Label sectionTitle>Search</Label>
            <Text color="subtle">
              Optimize the way this page appears in search engine results pages.
            </Text>
            <Grid gap={1}>
              <Label>Search Result Preview</Label>
              <Box
                css={{
                  padding: theme.spacing[5],
                  background: theme.colors.white,
                  borderRadius: theme.borderRadius[4],
                  border: `1px solid ${theme.colors.borderMain}`,
                }}
              >
                <Box
                  css={{
                    transformOrigin: "top left",
                    transform: "scale(0.667)",
                    width: 600,
                    height: 80,
                  }}
                >
                  <SearchPreview
                    siteName={pages?.meta?.siteName ?? ""}
                    faviconUrl={faviconUrl}
                    pageUrl={pageUrl}
                    titleLink={values.title}
                    snippet={values.description}
                  />
                </Box>
              </Box>
            </Grid>
          </Grid>

          <Grid gap={1}>
            <Label htmlFor={fieldIds.title}>Title</Label>
            <InputErrorsTooltip errors={errors.title}>
              <InputField
                tabIndex={1}
                color={errors.title && "error"}
                id={fieldIds.title}
                name="title"
                placeholder="My awesome project - About"
                disabled={disabled}
                value={values.title}
                onChange={(event) => {
                  onChange({ field: "title", value: event.target.value });
                }}
              />
            </InputErrorsTooltip>
          </Grid>

          <Grid gap={1}>
            <Label htmlFor={fieldIds.description}>Description</Label>
            <InputErrorsTooltip errors={errors.description}>
              <TextArea
                tabIndex={1}
                state={errors.description && "invalid"}
                id={fieldIds.description}
                name="description"
                disabled={disabled}
                value={values.description}
                onChange={(value) => {
                  onChange({ field: "description", value });
                }}
                autoGrow
                maxRows={10}
              />
            </InputErrorsTooltip>
            <Grid flow={"column"} gap={1} justify={"start"} align={"center"}>
              <Checkbox
                id={fieldIds.excludePageFromSearch}
                checked={values.excludePageFromSearch}
                onCheckedChange={() => {
                  onChange({
                    field: "excludePageFromSearch",
                    value: !values.excludePageFromSearch,
                  });
                }}
              />

              <Label htmlFor={fieldIds.excludePageFromSearch}>
                Exclude this page from search results
              </Label>
            </Grid>
          </Grid>
        </Grid>

        <Separator />

        {/**
         * ----------------------========<<<Social Sharing>>>>========----------------------
         */}
        <Grid gap={2} css={{ my: theme.spacing[5], mx: theme.spacing[8] }}>
          <Label htmlFor={fieldIds.socialImageAssetId} sectionTitle>
            Social Image
          </Label>
          <Text color="subtle">
            This image appears when you share a link to this page on social
            media sites. If no image is set here, the Social Image set in the
            Project Settings will be used. The optimal dimensions for the image
            are 1200x630 px or larger with a 1.91:1 aspect ratio.
          </Text>
          <Grid gap={1} flow={"column"}>
            <ImageControl
              assetId={values.socialImageAssetId}
              onAssetIdChange={(socialImageAssetId) =>
                onChange({
                  field: "socialImageAssetId",
                  value: socialImageAssetId,
                })
              }
            >
              <Button
                id={fieldIds.socialImageAssetId}
                css={{ justifySelf: "start" }}
                color="neutral"
              >
                Choose Image From Assets
              </Button>
            </ImageControl>
          </Grid>

          {socialImageAsset?.type === "image" && (
            <ImageInfo
              asset={socialImageAsset}
              onDelete={() => {
                onChange({
                  field: "socialImageAssetId",
                  value: "",
                });
              }}
            />
          )}
          <div />
          <SocialPreview
            asset={
              socialImageAsset?.type === "image" ? socialImageAsset : undefined
            }
            ogUrl={pageUrl}
            ogTitle={values.title}
            ogDescription={values.description}
          />
        </Grid>

        <Separator />

        <CustomMetadata
          customMetas={values.customMetas}
          onChange={(customMetas) => {
            onChange({
              field: "customMetas",
              value: customMetas,
            });
          }}
        />
        <Box css={{ height: theme.spacing[10] }} />
      </ScrollArea>
    </Grid>
  );
};

const nameToPath = (pages: Pages | undefined, name: string) => {
  if (name === "") {
    return "";
  }

  const slug = slugify(name, { lower: true, strict: true });
  const path = `/${slug}`;

  // for TypeScript
  if (pages === undefined) {
    return path;
  }

  if (findPageByIdOrPath(pages, path) === undefined) {
    return path;
  }

  let suffix = 1;

  while (findPageByIdOrPath(pages, `${path}${suffix}`) !== undefined) {
    suffix++;
  }

  return `${path}${suffix}`;
};

export const NewPageSettings = ({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (pageId: Page["id"]) => void;
}) => {
  const pages = useStore(pagesStore);

  const [values, setValues] = useState<Values>({
    ...fieldDefaultValues,
    path: nameToPath(pages, fieldDefaultValues.name),
  });
  const errors = validateValues(pages, undefined, values, false);

  const handleSubmit = () => {
    if (Object.keys(errors).length === 0) {
      const pageId = nanoid();

      serverSyncStore.createTransaction(
        [pagesStore, instancesStore],
        (pages, instances) => {
          if (pages === undefined) {
            return;
          }
          const rootInstanceId = nanoid();
          pages.pages.push({
            id: pageId,
            name: values.name,
            path: values.path,
            title: values.title,
            rootInstanceId,
            meta: {},
          });

          instances.set(rootInstanceId, {
            type: "instance",
            id: rootInstanceId,
            component: "Body",
            children: [],
          });
          selectedInstanceSelectorStore.set(undefined);
        }
      );

      updatePage(pageId, values);

      onSuccess(pageId);
    }
  };

  return (
    <NewPageSettingsView
      onSubmit={handleSubmit}
      onClose={onClose}
      isSubmitting={false}
      errors={errors}
      disabled={false}
      values={values}
      onChange={(val) => {
        setValues((values) => {
          const changes = { [val.field]: val.value };

          if (val.field === "name") {
            if (values.path === nameToPath(pages, values.name)) {
              changes.path = nameToPath(pages, val.value);
            }
            if (values.title === values.name) {
              changes.title = val.value;
            }
          }
          return { ...values, ...changes };
        });
      }}
    />
  );
};

const NewPageSettingsView = ({
  onSubmit,
  isSubmitting,
  onClose,
  ...formFieldsProps
}: {
  onSubmit: () => void;
  isSubmitting: boolean;
  onClose: () => void;
} & ComponentProps<typeof FormFields>) => {
  return (
    <>
      <Header
        title="New Page Settings"
        suffix={
          <>
            {onClose && (
              <Tooltip content="Cancel" side="bottom">
                <Button
                  onClick={onClose}
                  aria-label="Cancel"
                  prefix={<ChevronDoubleLeftIcon />}
                  color="ghost"
                  // Tab should go:
                  //   trought form fields -> create button -> cancel button
                  tabIndex={3}
                />
              </Tooltip>
            )}
            <HeaderSuffixSpacer />
            <Button
              state={isSubmitting ? "pending" : "auto"}
              onClick={onSubmit}
              tabIndex={2}
            >
              {isSubmitting ? "Creating" : "Create page"}
            </Button>
          </>
        }
      />
      <Box
        css={{
          overflow: "auto",
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <FormFields autoSelect {...formFieldsProps} />
          <input type="submit" hidden />
        </form>
      </Box>
    </>
  );
};

const updatePage = (pageId: Page["id"], values: Partial<Values>) => {
  const updatePageMutable = (page: Page, values: Partial<Values>) => {
    if (values.name !== undefined) {
      page.name = values.name;
    }
    if (values.path !== undefined) {
      page.path = values.path;
    }
    if (values.title !== undefined) {
      page.title = values.title;
    }

    if (values.description !== undefined) {
      page.meta.description = values.description;
    }

    if (values.excludePageFromSearch !== undefined) {
      page.meta.excludePageFromSearch = values.excludePageFromSearch;
    }

    if (values.socialImageAssetId !== undefined) {
      page.meta.socialImageAssetId = values.socialImageAssetId;
    }

    if (values.customMetas !== undefined) {
      page.meta.custom = values.customMetas;
    }
  };

  serverSyncStore.createTransaction(
    [pagesStore, $dataSources],
    (pages, dataSources) => {
      if (pages === undefined) {
        return;
      }

      // swap home page
      if (values.isHomePage && pages.homePage.id !== pageId) {
        const newHomePageIndex = pages.pages.findIndex(
          (page) => page.id === pageId
        );

        if (newHomePageIndex === -1) {
          throw new Error(`Page with id ${pageId} not found`);
        }

        const tmp = pages.homePage;
        pages.homePage = pages.pages[newHomePageIndex];

        pages.homePage.path = "";
        pages.pages[newHomePageIndex] = tmp;

        tmp.path = nameToPath(pages, tmp.name);
      }

      if (pages.homePage.id === pageId) {
        updatePageMutable(pages.homePage, values);
      }

      for (const page of pages.pages) {
        if (page.id === pageId) {
          // create "Page params" variable when pattern is specified in path
          const paramNames = parsePathnamePattern(page.path);
          if (paramNames.length > 0 && page.pathVariableId === undefined) {
            page.pathVariableId = nanoid();
            dataSources.set(page.pathVariableId, {
              id: page.pathVariableId,
              // scope new variable to body
              scopeInstanceId: page.rootInstanceId,
              type: "parameter",
              name: "Page params",
            });
          }
          updatePageMutable(page, values);
        }
      }
    }
  );
};

const deletePage = (pageId: Page["id"]) => {
  const pages = pagesStore.get();
  // deselect page before deleting to avoid flash of content
  if (selectedPageIdStore.get() === pageId) {
    selectedPageIdStore.set(pages?.homePage.id);
    selectedInstanceSelectorStore.set(undefined);
  }
  const rootInstanceId = pages?.pages.find(
    (page) => page.id === pageId
  )?.rootInstanceId;
  if (rootInstanceId !== undefined) {
    deleteInstance([rootInstanceId]);
  }
  serverSyncStore.createTransaction([pagesStore], (pages) => {
    if (pages === undefined) {
      return;
    }
    removeByMutable(pages.pages, (page) => page.id === pageId);
  });
};

const duplicatePage = (pageId: Page["id"]) => {
  const pages = pagesStore.get();
  const page =
    pages?.homePage.id === pageId
      ? pages.homePage
      : pages?.pages.find((page) => page.id === pageId);
  if (page === undefined) {
    return;
  }

  const newPageId = nanoid();
  const { name = page.name, copyNumber } =
    // extract a number from "name (copyNumber)"
    page.name.match(/^(?<name>.+) \((?<copyNumber>\d+)\)$/)?.groups ?? {};
  const newName = `${name} (${Number(copyNumber ?? "0") + 1})`;

  const slice = getInstancesSlice(page.rootInstanceId);
  insertInstancesSliceCopy({
    slice,
    availableDataSources: new Set(),
    beforeTransactionEnd: (rootInstanceId, draft) => {
      const newPage = {
        ...page,
        id: newPageId,
        rootInstanceId,
        name: newName,
        path: nameToPath(pages, newName),
      };
      draft.pages?.pages.push(newPage);
    },
  });
  return newPageId;
};

export const PageSettings = ({
  onClose,
  onDuplicate,
  onDelete,
  pageId,
}: {
  onClose: () => void;
  onDuplicate: (newPageId: string) => void;
  onDelete: () => void;
  pageId: string;
}) => {
  const pages = useStore(pagesStore);
  const page = pages && findPageByIdOrPath(pages, pageId);

  const isHomePage = page?.id === pages?.homePage.id;

  const [unsavedValues, setUnsavedValues] = useState<Partial<Values>>({});

  const values: Values = {
    ...(page ? toFormPage(page, isHomePage) : fieldDefaultValues),
    ...unsavedValues,
  };

  const errors = validateValues(pages, pageId, values, values.isHomePage);

  const debouncedFn = useEffectEvent(() => {
    if (
      Object.keys(unsavedValues).length === 0 ||
      Object.keys(errors).length !== 0
    ) {
      return;
    }

    updatePage(pageId, unsavedValues);

    setUnsavedValues({});
  });

  const handleSubmitDebounced = useDebouncedCallback(debouncedFn, 1000);

  const handleChange = useCallback(
    <Name extends FieldName>(event: { field: Name; value: Values[Name] }) => {
      setUnsavedValues((values) => ({
        ...values,
        [event.field]: event.value,
      }));
      handleSubmitDebounced();
    },
    [handleSubmitDebounced]
  );

  useUnmount(() => {
    if (
      Object.keys(unsavedValues).length === 0 ||
      Object.keys(errors).length !== 0
    ) {
      return;
    }
    updatePage(pageId, unsavedValues);
  });

  const hanldeDelete = () => {
    deletePage(pageId);
    onDelete();
  };

  if (page === undefined) {
    return null;
  }

  return (
    <PageSettingsView
      pathVariableId={page.pathVariableId}
      onClose={onClose}
      onDelete={hanldeDelete}
      onDuplicate={() => {
        const newPageId = duplicatePage(pageId);
        if (newPageId !== undefined) {
          onDuplicate(newPageId);
        }
      }}
      errors={errors}
      values={values}
      onChange={handleChange}
    />
  );
};

const PageSettingsView = ({
  onDelete,
  onDuplicate,
  onClose,
  ...formFieldsProps
}: {
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
} & ComponentProps<typeof FormFields>) => {
  return (
    <>
      <Header
        title="Page Settings"
        suffix={
          <>
            {formFieldsProps.values.isHomePage === false && (
              <Tooltip content="Delete page" side="bottom">
                <Button
                  color="ghost"
                  prefix={<TrashIcon />}
                  onClick={onDelete}
                  aria-label="Delete page"
                  tabIndex={2}
                />
              </Tooltip>
            )}
            <Tooltip content="Duplicate page" side="bottom">
              <Button
                color="ghost"
                prefix={<CopyIcon />}
                onClick={onDuplicate}
                aria-label="Duplicate page"
                tabIndex={2}
              />
            </Tooltip>
            {onClose && (
              <Tooltip content="Close page settings" side="bottom">
                <Button
                  color="ghost"
                  prefix={<ChevronDoubleLeftIcon />}
                  onClick={onClose}
                  aria-label="Close page settings"
                  tabIndex={2}
                />
              </Tooltip>
            )}
          </>
        }
      />
      <Box
        css={{
          overflow: "auto",
        }}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onClose?.();
          }}
        >
          <FormFields {...formFieldsProps} />
          <input type="submit" hidden />
        </form>
      </Box>
    </>
  );
};
