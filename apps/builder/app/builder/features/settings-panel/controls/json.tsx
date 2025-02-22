import { useStore } from "@nanostores/react";
import { theme, Box } from "@webstudio-is/design-system";
import {
  type ControlProps,
  getLabel,
  useLocalValue,
  VerticalLayout,
  Label,
  updateExpressionValue,
  $selectedInstanceScope,
} from "../shared";
import {
  ExpressionEditor,
  formatValue,
} from "~/builder/shared/expression-editor";
import { BindingPopover } from "~/builder/shared/binding-popover";

export const JsonControl = ({
  meta,
  prop,
  propName,
  computedValue,
  deletable,
  readOnly,
  onChange,
  onDelete,
}: ControlProps<"json">) => {
  const valueString = formatValue(computedValue ?? "");
  const localValue = useLocalValue(valueString, (value) => {
    try {
      // wrap into parens to treat object expression as value instead of block
      const parsedValue = eval(`(${value})`);
      if (prop?.type === "expression") {
        updateExpressionValue(prop.value, parsedValue);
      } else {
        onChange({ type: "json", value: parsedValue });
      }
    } catch {
      // empty block
    }
  });
  const label = getLabel(meta, propName);

  const { scope, aliases } = useStore($selectedInstanceScope);
  const expression = prop?.type === "expression" ? prop.value : valueString;

  return (
    <VerticalLayout
      label={
        <Label description={meta.description} readOnly={readOnly}>
          {label}
        </Label>
      }
      deletable={deletable}
      onDelete={onDelete}
    >
      <Box css={{ position: "relative", py: theme.spacing[2] }}>
        <ExpressionEditor
          readOnly={readOnly}
          value={localValue.value}
          onChange={localValue.set}
          onBlur={localValue.save}
        />
        <BindingPopover
          scope={scope}
          aliases={aliases}
          value={expression}
          onChange={(newExpression) =>
            onChange({ type: "expression", value: newExpression })
          }
          onRemove={(evaluatedValue) =>
            onChange({ type: "json", value: evaluatedValue })
          }
        />
      </Box>
    </VerticalLayout>
  );
};
