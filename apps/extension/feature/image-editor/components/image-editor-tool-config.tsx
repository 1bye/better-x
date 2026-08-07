// biome-ignore-all lint/performance/noJsxPropsBind: Configuration updates stay beside the control that owns them.
import { Button } from "@better-x/ui/components/button";
import { Kbd } from "@better-x/ui/components/kbd";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { CropIcon } from "@phosphor-icons/react/dist/csr/Crop";
import { FlipHorizontalIcon } from "@phosphor-icons/react/dist/csr/FlipHorizontal";
import { FlipVerticalIcon } from "@phosphor-icons/react/dist/csr/FlipVertical";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { ReactElement, ReactNode } from "react";
import type {
  EditorTool,
  ImageSceneObject,
  SceneBackground,
  SceneDocument,
  SceneObject,
  SceneToolDefaults,
  SceneToolStyleChange,
} from "../lib/image-editor";

export type ImageEditorConfigTool = EditorTool | "crop";

type SceneObjectUpdate = (object: SceneObject) => SceneObject;

export interface ImageEditorToolConfigProps {
  readonly isCropping: boolean;
  readonly onCanvasPreset: (ratio: number | null) => void;
  readonly onCanvasUpdate: (
    update: Partial<Pick<SceneDocument, "height" | "width">>
  ) => void;
  readonly onCommit: () => void;
  readonly onCropAspect: (ratio: number | null) => void;
  readonly onCropFlip: (axis: "x" | "y") => void;
  readonly onCropReset: () => void;
  readonly onCropRotate: (degrees: number) => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onReorder: (direction: -1 | 1) => void;
  readonly onToggleCrop: () => void;
  readonly onUpdateBackground: (update: Partial<SceneBackground>) => void;
  readonly onUpdateSelected: (update: SceneObjectUpdate) => void;
  readonly onUpdateToolStyle: (change: SceneToolStyleChange) => void;
  readonly scene: SceneDocument;
  readonly selected: SceneObject | null;
  readonly tool: ImageEditorConfigTool;
}

interface ValueControlProps {
  readonly label: string;
  readonly onCommit: () => void;
  readonly onValue: (value: number) => void;
  readonly value: number;
}

interface RangeControlProps extends ValueControlProps {
  readonly maximum: number;
  readonly minimum: number;
  readonly step?: number;
}

function ConfigSection({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}): ReactElement {
  return (
    <section className="better-x-image-editor__inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Field({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: string;
}): ReactElement {
  return (
    <div className="better-x-image-editor__field">
      <span>{label}</span>
      {children}
    </div>
  );
}

function NumberControl({
  label,
  maximum,
  minimum,
  onCommit,
  onValue,
  step = 1,
  value,
}: ValueControlProps & {
  readonly maximum?: number;
  readonly minimum?: number;
  readonly step?: number;
}): ReactElement {
  return (
    <input
      aria-label={label}
      className="better-x-image-editor__input"
      max={maximum}
      min={minimum}
      onBlur={onCommit}
      onChange={(event) => {
        const next = Number(event.currentTarget.value);
        if (Number.isFinite(next)) {
          onValue(next);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      step={step}
      type="number"
      value={Number(value.toFixed(2))}
    />
  );
}

function RangeControl({
  label,
  maximum,
  minimum,
  onCommit,
  onValue,
  step = 1,
  value,
}: RangeControlProps): ReactElement {
  return (
    <span className="better-x-image-editor__range-control">
      <input
        aria-label={label}
        max={maximum}
        min={minimum}
        onBlur={onCommit}
        onChange={(event) => onValue(Number(event.currentTarget.value))}
        onKeyUp={onCommit}
        onPointerUp={onCommit}
        step={step}
        type="range"
        value={value}
      />
      <output>{Number(value.toFixed(2))}</output>
    </span>
  );
}

function ColorControl({
  label,
  onCommit,
  onValue,
  value,
}: {
  readonly label: string;
  readonly onCommit: () => void;
  readonly onValue: (value: string) => void;
  readonly value: string;
}): ReactElement {
  return (
    <input
      aria-label={label}
      className="better-x-image-editor__color"
      onBlur={onCommit}
      onChange={(event) => onValue(event.currentTarget.value)}
      type="color"
      value={value.startsWith("#") ? value.slice(0, 7) : "#000000"}
    />
  );
}

function SelectControl({
  label,
  onCommit,
  onValue,
  options,
  value,
}: {
  readonly label: string;
  readonly onCommit: () => void;
  readonly onValue: (value: string) => void;
  readonly options: readonly { label: string; value: string }[];
  readonly value: string;
}): ReactElement {
  return (
    <select
      aria-label={label}
      className="better-x-image-editor__select"
      onChange={(event) => {
        onValue(event.currentTarget.value);
        onCommit();
      }}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ToggleControl({
  checked,
  label,
  onCommit,
  onValue,
}: {
  readonly checked: boolean;
  readonly label: string;
  readonly onCommit: () => void;
  readonly onValue: (value: boolean) => void;
}): ReactElement {
  return (
    <input
      aria-label={label}
      checked={checked}
      className="better-x-image-editor__toggle"
      onChange={(event) => {
        onValue(event.currentTarget.checked);
        onCommit();
      }}
      type="checkbox"
    />
  );
}

function OpacityControl({
  onCommit,
  onValue,
  value,
}: {
  readonly onCommit: () => void;
  readonly onValue: (opacity: number) => void;
  readonly value: number;
}): ReactElement {
  return (
    <Field label="Opacity">
      <RangeControl
        label="Opacity"
        maximum={100}
        minimum={0}
        onCommit={onCommit}
        onValue={(opacity) => onValue(opacity / 100)}
        value={Math.round(value * 100)}
      />
    </Field>
  );
}

function ArrowConfig({
  onCommit,
  onUpdate,
  value,
}: {
  readonly onCommit: () => void;
  readonly onUpdate: (update: Partial<SceneToolDefaults["arrow"]>) => void;
  readonly value: SceneToolDefaults["arrow"];
}): ReactElement {
  return (
    <ConfigSection title="Arrow">
      <Field label="Color">
        <ColorControl
          label="Arrow color"
          onCommit={onCommit}
          onValue={(stroke) => onUpdate({ stroke })}
          value={value.stroke}
        />
      </Field>
      <Field label="Width">
        <RangeControl
          label="Arrow stroke width"
          maximum={40}
          minimum={1}
          onCommit={onCommit}
          onValue={(strokeWidth) => onUpdate({ strokeWidth })}
          value={value.strokeWidth}
        />
      </Field>
      <Field label="Line">
        <SelectControl
          label="Arrow line style"
          onCommit={onCommit}
          onValue={(lineStyle) =>
            onUpdate({
              lineStyle:
                lineStyle === "dashed" || lineStyle === "dotted"
                  ? lineStyle
                  : "solid",
            })
          }
          options={[
            { label: "Solid", value: "solid" },
            { label: "Dashed", value: "dashed" },
            { label: "Dotted", value: "dotted" },
          ]}
          value={value.lineStyle}
        />
      </Field>
      <Field label="Head">
        <SelectControl
          label="Arrowhead"
          onCommit={onCommit}
          onValue={(arrowhead) =>
            onUpdate({
              arrowhead:
                arrowhead === "filled" || arrowhead === "none"
                  ? arrowhead
                  : "open",
            })
          }
          options={[
            { label: "Open", value: "open" },
            { label: "Filled", value: "filled" },
            { label: "None", value: "none" },
          ]}
          value={value.arrowhead}
        />
      </Field>
      <OpacityControl
        onCommit={onCommit}
        onValue={(opacity) => onUpdate({ opacity })}
        value={value.opacity}
      />
    </ConfigSection>
  );
}

function RectangleConfig({
  onCommit,
  onUpdate,
  value,
}: {
  readonly onCommit: () => void;
  readonly onUpdate: (update: Partial<SceneToolDefaults["rectangle"]>) => void;
  readonly value: SceneToolDefaults["rectangle"];
}): ReactElement {
  return (
    <ConfigSection title="Rectangle">
      <Field label="Fill">
        <ColorControl
          label="Rectangle fill"
          onCommit={onCommit}
          onValue={(fill) => onUpdate({ fill })}
          value={value.fill}
        />
      </Field>
      <Field label="Stroke">
        <ColorControl
          label="Rectangle stroke"
          onCommit={onCommit}
          onValue={(stroke) => onUpdate({ stroke })}
          value={value.stroke}
        />
      </Field>
      <Field label="Stroke width">
        <RangeControl
          label="Rectangle stroke width"
          maximum={40}
          minimum={0}
          onCommit={onCommit}
          onValue={(strokeWidth) => onUpdate({ strokeWidth })}
          value={value.strokeWidth}
        />
      </Field>
      <Field label="Roundness">
        <RangeControl
          label="Rectangle corner roundness"
          maximum={240}
          minimum={0}
          onCommit={onCommit}
          onValue={(radius) => onUpdate({ radius })}
          value={value.radius}
        />
      </Field>
      <OpacityControl
        onCommit={onCommit}
        onValue={(opacity) => onUpdate({ opacity })}
        value={value.opacity}
      />
    </ConfigSection>
  );
}

function TextConfig({
  onCommit,
  onUpdate,
  value,
}: {
  readonly onCommit: () => void;
  readonly onUpdate: (update: Partial<SceneToolDefaults["text"]>) => void;
  readonly value: SceneToolDefaults["text"];
}): ReactElement {
  const hasBackground = value.background !== "transparent";
  return (
    <ConfigSection title="Text">
      <Field label="Font">
        <SelectControl
          label="Font family"
          onCommit={onCommit}
          onValue={(fontFamily) => onUpdate({ fontFamily })}
          options={[
            {
              label: "Twitter Chirp",
              value: "TwitterChirp, Inter, sans-serif",
            },
            {
              label: "System Sans",
              value: "Inter, -apple-system, sans-serif",
            },
            { label: "Georgia", value: "Georgia, serif" },
            {
              label: "Monospace",
              value: "ui-monospace, SFMono-Regular, monospace",
            },
          ]}
          value={value.fontFamily}
        />
      </Field>
      <div className="better-x-image-editor__field-grid">
        <Field label="Size">
          <NumberControl
            label="Font size"
            maximum={500}
            minimum={6}
            onCommit={onCommit}
            onValue={(fontSize) => onUpdate({ fontSize })}
            value={value.fontSize}
          />
        </Field>
        <Field label="Weight">
          <SelectControl
            label="Font weight"
            onCommit={onCommit}
            onValue={(fontWeight) =>
              onUpdate({ fontWeight: Number(fontWeight) })
            }
            options={[
              { label: "Regular", value: "400" },
              { label: "Medium", value: "500" },
              { label: "Semibold", value: "600" },
              { label: "Bold", value: "700" },
              { label: "Black", value: "900" },
            ]}
            value={String(value.fontWeight)}
          />
        </Field>
      </div>
      <Field label="Align">
        <SelectControl
          label="Text alignment"
          onCommit={onCommit}
          onValue={(align) =>
            onUpdate({
              align: align === "center" || align === "right" ? align : "left",
            })
          }
          options={[
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
            { label: "Right", value: "right" },
          ]}
          value={value.align}
        />
      </Field>
      <Field label="Line height">
        <RangeControl
          label="Text line height"
          maximum={2}
          minimum={0.7}
          onCommit={onCommit}
          onValue={(lineHeight) => onUpdate({ lineHeight })}
          step={0.05}
          value={value.lineHeight}
        />
      </Field>
      <Field label="Text color">
        <ColorControl
          label="Text color"
          onCommit={onCommit}
          onValue={(color) => onUpdate({ color })}
          value={value.color}
        />
      </Field>
      <Field label="Background">
        <ToggleControl
          checked={hasBackground}
          label="Text background"
          onCommit={onCommit}
          onValue={(enabled) =>
            onUpdate({ background: enabled ? "#0f1419" : "transparent" })
          }
        />
      </Field>
      {hasBackground ? (
        <Field label="Background color">
          <ColorControl
            label="Text background color"
            onCommit={onCommit}
            onValue={(background) => onUpdate({ background })}
            value={value.background}
          />
        </Field>
      ) : null}
      <OpacityControl
        onCommit={onCommit}
        onValue={(opacity) => onUpdate({ opacity })}
        value={value.opacity}
      />
    </ConfigSection>
  );
}

function BlurConfig({
  onCommit,
  onUpdate,
  value,
}: {
  readonly onCommit: () => void;
  readonly onUpdate: (update: Partial<SceneToolDefaults["blur"]>) => void;
  readonly value: SceneToolDefaults["blur"];
}): ReactElement {
  return (
    <ConfigSection title="Blur">
      <Field label="Shape">
        <SelectControl
          label="Blur shape"
          onCommit={onCommit}
          onValue={(shape) =>
            onUpdate({ shape: shape === "ellipse" ? "ellipse" : "rectangle" })
          }
          options={[
            { label: "Rectangle", value: "rectangle" },
            { label: "Ellipse", value: "ellipse" },
          ]}
          value={value.shape}
        />
      </Field>
      <Field label="Strength">
        <RangeControl
          label="Blur strength"
          maximum={80}
          minimum={2}
          onCommit={onCommit}
          onValue={(strength) => onUpdate({ strength })}
          value={value.strength}
        />
      </Field>
      <Field label="Feather">
        <RangeControl
          label="Blur feathering"
          maximum={80}
          minimum={0}
          onCommit={onCommit}
          onValue={(feather) => onUpdate({ feather })}
          value={value.feather}
        />
      </Field>
      {value.shape === "rectangle" ? (
        <Field label="Roundness">
          <RangeControl
            label="Blur corner roundness"
            maximum={240}
            minimum={0}
            onCommit={onCommit}
            onValue={(radius) => onUpdate({ radius })}
            value={value.radius}
          />
        </Field>
      ) : null}
      <OpacityControl
        onCommit={onCommit}
        onValue={(opacity) => onUpdate({ opacity })}
        value={value.opacity}
      />
    </ConfigSection>
  );
}

function TransformConfig({
  object,
  onCommit,
  onUpdate,
}: {
  readonly object: SceneObject;
  readonly onCommit: () => void;
  readonly onUpdate: (update: SceneObjectUpdate) => void;
}): ReactElement {
  return (
    <ConfigSection title="Selection">
      <div className="better-x-image-editor__field-grid">
        {(
          [
            ["X", "x"],
            ["Y", "y"],
            ["W", "width"],
            ["H", "height"],
            ["°", "rotation"],
          ] as const
        ).map(([label, key]) => (
          <Field key={key} label={label}>
            <NumberControl
              label={label}
              minimum={key === "width" || key === "height" ? 12 : undefined}
              onCommit={onCommit}
              onValue={(value) =>
                onUpdate((candidate) => ({ ...candidate, [key]: value }))
              }
              value={object[key]}
            />
          </Field>
        ))}
      </div>
      <OpacityControl
        onCommit={onCommit}
        onValue={(opacity) =>
          onUpdate((candidate) => ({ ...candidate, opacity }))
        }
        value={object.opacity}
      />
    </ConfigSection>
  );
}

function ImageConfig({
  isCropping,
  object,
  onCommit,
  onToggleCrop,
  onUpdate,
}: {
  readonly isCropping: boolean;
  readonly object: ImageSceneObject;
  readonly onCommit: () => void;
  readonly onToggleCrop: () => void;
  readonly onUpdate: (update: SceneObjectUpdate) => void;
}): ReactElement {
  return (
    <ConfigSection title="Image">
      <Button
        className="better-x-image-editor__inspector-action"
        onClick={onToggleCrop}
        size="sm"
        type="button"
        variant="ghost"
      >
        <CropIcon aria-hidden className="better-x-image-editor__icon" />
        <span className="better-x-image-editor__button-label">
          {isCropping ? "Finish crop" : "Crop image"}
        </span>
        <Kbd>C</Kbd>
      </Button>
      {(
        [
          ["Brightness", "brightness"],
          ["Contrast", "contrast"],
          ["Saturation", "saturation"],
        ] as const
      ).map(([label, key]) => (
        <Field key={key} label={label}>
          <RangeControl
            label={label}
            maximum={200}
            minimum={0}
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "image"
                  ? { ...candidate, [key]: value }
                  : candidate
              )
            }
            value={object[key]}
          />
        </Field>
      ))}
      <Field label="Roundness">
        <RangeControl
          label="Image corner roundness"
          maximum={Math.round(Math.min(object.width, object.height) / 2)}
          minimum={0}
          onCommit={onCommit}
          onValue={(radius) =>
            onUpdate((candidate) =>
              candidate.kind === "image" ? { ...candidate, radius } : candidate
            )
          }
          value={object.radius}
        />
      </Field>
    </ConfigSection>
  );
}

function ArrangeConfig({
  object,
  onCommit,
  onDelete,
  onDuplicate,
  onReorder,
  onUpdate,
}: {
  readonly object: SceneObject;
  readonly onCommit: () => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onReorder: (direction: -1 | 1) => void;
  readonly onUpdate: (update: SceneObjectUpdate) => void;
}): ReactElement {
  return (
    <ConfigSection title="Arrange">
      <Field label="Locked">
        <ToggleControl
          checked={object.locked}
          label="Lock object"
          onCommit={onCommit}
          onValue={(locked) =>
            onUpdate((candidate) => ({ ...candidate, locked }))
          }
        />
      </Field>
      <div className="better-x-image-editor__inspector-actions">
        <Button
          onClick={() => onReorder(1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowUpIcon aria-hidden className="better-x-image-editor__icon" />
          Forward
        </Button>
        <Button
          onClick={() => onReorder(-1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowDownIcon aria-hidden className="better-x-image-editor__icon" />
          Backward
        </Button>
        <Button onClick={onDuplicate} size="sm" type="button" variant="ghost">
          <CopyIcon aria-hidden className="better-x-image-editor__icon" />
          Duplicate
        </Button>
        <Button onClick={onDelete} size="sm" type="button" variant="ghost">
          <TrashIcon aria-hidden className="better-x-image-editor__icon" />
          Delete
        </Button>
      </div>
    </ConfigSection>
  );
}

function CanvasConfig({
  onCanvasPreset,
  onCanvasUpdate,
  onCommit,
  onUpdateBackground,
  scene,
}: Pick<
  ImageEditorToolConfigProps,
  | "onCanvasPreset"
  | "onCanvasUpdate"
  | "onCommit"
  | "onUpdateBackground"
  | "scene"
>): ReactElement {
  return (
    <>
      <ConfigSection title="Canvas">
        <div className="better-x-image-editor__preset-grid">
          {[
            { label: "Original", ratio: null },
            { label: "1:1", ratio: 1 },
            { label: "4:5", ratio: 4 / 5 },
            { label: "16:9", ratio: 16 / 9 },
          ].map((preset) => (
            <Button
              className="better-x-image-editor__preset"
              key={preset.label}
              onClick={() => onCanvasPreset(preset.ratio)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <div className="better-x-image-editor__field-grid">
          <Field label="W">
            <NumberControl
              label="Canvas width"
              maximum={16_384}
              minimum={64}
              onCommit={onCommit}
              onValue={(width) => onCanvasUpdate({ width })}
              value={scene.width}
            />
          </Field>
          <Field label="H">
            <NumberControl
              label="Canvas height"
              maximum={16_384}
              minimum={64}
              onCommit={onCommit}
              onValue={(height) => onCanvasUpdate({ height })}
              value={scene.height}
            />
          </Field>
        </div>
      </ConfigSection>
      <ConfigSection title="Background">
        <Field label="Presentation">
          <ToggleControl
            checked={scene.background.enabled}
            label="Presentation background"
            onCommit={onCommit}
            onValue={(enabled) => onUpdateBackground({ enabled })}
          />
        </Field>
        {scene.background.enabled ? (
          <>
            <Field label="Style">
              <SelectControl
                label="Background style"
                onCommit={onCommit}
                onValue={(type) =>
                  onUpdateBackground({
                    type: type === "solid" ? "solid" : "gradient",
                  })
                }
                options={[
                  { label: "Gradient", value: "gradient" },
                  { label: "Solid", value: "solid" },
                ]}
                value={scene.background.type}
              />
            </Field>
            <Field label="Color">
              <ColorControl
                label="Background color"
                onCommit={onCommit}
                onValue={(color) => onUpdateBackground({ color })}
                value={scene.background.color}
              />
            </Field>
            {scene.background.type === "gradient" ? (
              <>
                <Field label="Second color">
                  <ColorControl
                    label="Background second color"
                    onCommit={onCommit}
                    onValue={(color2) => onUpdateBackground({ color2 })}
                    value={scene.background.color2}
                  />
                </Field>
                <Field label="Angle">
                  <RangeControl
                    label="Gradient angle"
                    maximum={360}
                    minimum={0}
                    onCommit={onCommit}
                    onValue={(angle) => onUpdateBackground({ angle })}
                    value={scene.background.angle}
                  />
                </Field>
              </>
            ) : null}
            {(
              [
                [
                  "Padding",
                  "padding",
                  Math.round(Math.min(scene.width, scene.height) / 2),
                ],
                ["Roundness", "radius", 240],
                ["Image shadow", "shadow", 160],
              ] as const
            ).map(([label, key, maximum]) => (
              <Field key={key} label={label}>
                <RangeControl
                  label={label}
                  maximum={maximum}
                  minimum={0}
                  onCommit={onCommit}
                  onValue={(value) => onUpdateBackground({ [key]: value })}
                  value={scene.background[key]}
                />
              </Field>
            ))}
          </>
        ) : null}
      </ConfigSection>
    </>
  );
}

function CropConfig({
  isCropping,
  object,
  onCommit,
  onCropAspect,
  onCropFlip,
  onCropReset,
  onCropRotate,
  onToggleCrop,
}: Pick<
  ImageEditorToolConfigProps,
  | "isCropping"
  | "onCommit"
  | "onCropAspect"
  | "onCropFlip"
  | "onCropReset"
  | "onCropRotate"
  | "onToggleCrop"
> & {
  readonly object: ImageSceneObject;
}): ReactElement {
  const run = (operation: () => void): void => {
    operation();
    onCommit();
  };

  return (
    <ConfigSection title="Crop">
      <Field label="Aspect">
        <SelectControl
          label="Crop aspect ratio"
          onCommit={onCommit}
          onValue={(value) =>
            onCropAspect(value === "free" ? null : Number(value))
          }
          options={[
            { label: "Freeform", value: "free" },
            { label: "1:1", value: "1" },
            { label: "4:5", value: "0.8" },
            { label: "16:9", value: String(16 / 9) },
          ]}
          value={
            object.cropAspect === null ? "free" : String(object.cropAspect)
          }
        />
      </Field>
      <div className="better-x-image-editor__crop-actions">
        <Button
          aria-label="Rotate crop left"
          onClick={() => run(() => onCropRotate(-90))}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowCounterClockwiseIcon
            aria-hidden
            className="better-x-image-editor__icon"
          />
          Left
        </Button>
        <Button
          aria-label="Rotate crop right"
          onClick={() => run(() => onCropRotate(90))}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowClockwiseIcon
            aria-hidden
            className="better-x-image-editor__icon"
          />
          Right
        </Button>
        <Button
          aria-label="Flip crop horizontally"
          onClick={() => run(() => onCropFlip("x"))}
          size="sm"
          type="button"
          variant="ghost"
        >
          <FlipHorizontalIcon
            aria-hidden
            className="better-x-image-editor__icon"
          />
          Flip H
        </Button>
        <Button
          aria-label="Flip crop vertically"
          onClick={() => run(() => onCropFlip("y"))}
          size="sm"
          type="button"
          variant="ghost"
        >
          <FlipVerticalIcon
            aria-hidden
            className="better-x-image-editor__icon"
          />
          Flip V
        </Button>
      </div>
      <div className="better-x-image-editor__config-footer">
        <Button
          onClick={() => run(onCropReset)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Reset
        </Button>
        <Button
          disabled={!isCropping}
          onClick={onToggleCrop}
          size="sm"
          type="button"
          variant="brand"
        >
          Done
          <Kbd>↵</Kbd>
        </Button>
      </div>
    </ConfigSection>
  );
}

function StyleToolConfig({
  onCommit,
  onUpdateToolStyle,
  scene,
  selected,
  tool,
}: Pick<
  ImageEditorToolConfigProps,
  "onCommit" | "onUpdateToolStyle" | "scene" | "selected"
> & {
  readonly tool: Exclude<EditorTool, "select">;
}): ReactElement {
  if (tool === "arrow") {
    return (
      <ArrowConfig
        onCommit={onCommit}
        onUpdate={(update) => onUpdateToolStyle({ tool, update })}
        value={selected?.kind === "arrow" ? selected : scene.toolDefaults.arrow}
      />
    );
  }
  if (tool === "rectangle") {
    return (
      <RectangleConfig
        onCommit={onCommit}
        onUpdate={(update) => onUpdateToolStyle({ tool, update })}
        value={
          selected?.kind === "rectangle"
            ? selected
            : scene.toolDefaults.rectangle
        }
      />
    );
  }
  if (tool === "text") {
    return (
      <TextConfig
        onCommit={onCommit}
        onUpdate={(update) => onUpdateToolStyle({ tool, update })}
        value={selected?.kind === "text" ? selected : scene.toolDefaults.text}
      />
    );
  }
  return (
    <BlurConfig
      onCommit={onCommit}
      onUpdate={(update) => onUpdateToolStyle({ tool, update })}
      value={selected?.kind === "blur" ? selected : scene.toolDefaults.blur}
    />
  );
}

const TOOL_LABELS: Record<ImageEditorConfigTool, string> = {
  arrow: "Arrow",
  blur: "Blur",
  crop: "Crop",
  rectangle: "Rectangle",
  select: "Select",
  text: "Text",
};

export function ImageEditorToolConfig({
  isCropping,
  onCanvasPreset,
  onCanvasUpdate,
  onCommit,
  onCropAspect,
  onCropFlip,
  onCropReset,
  onCropRotate,
  onDelete,
  onDuplicate,
  onReorder,
  onToggleCrop,
  onUpdateBackground,
  onUpdateSelected,
  onUpdateToolStyle,
  scene,
  selected,
  tool,
}: ImageEditorToolConfigProps): ReactElement {
  const isSelectionTarget =
    tool === "crop" ? selected?.kind === "image" : selected?.kind === tool;

  let content: ReactNode;
  if (tool !== "select" && tool !== "crop") {
    content = (
      <StyleToolConfig
        onCommit={onCommit}
        onUpdateToolStyle={onUpdateToolStyle}
        scene={scene}
        selected={selected}
        tool={tool}
      />
    );
  } else if (tool === "crop" && selected?.kind === "image") {
    content = (
      <CropConfig
        isCropping={isCropping}
        object={selected}
        onCommit={onCommit}
        onCropAspect={onCropAspect}
        onCropFlip={onCropFlip}
        onCropReset={onCropReset}
        onCropRotate={onCropRotate}
        onToggleCrop={onToggleCrop}
      />
    );
  } else {
    content = (
      <>
        {selected ? (
          <>
            {selected.kind === "image" ? (
              <ImageConfig
                isCropping={isCropping}
                object={selected}
                onCommit={onCommit}
                onToggleCrop={onToggleCrop}
                onUpdate={onUpdateSelected}
              />
            ) : null}
            <TransformConfig
              object={selected}
              onCommit={onCommit}
              onUpdate={onUpdateSelected}
            />
            <ArrangeConfig
              object={selected}
              onCommit={onCommit}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onReorder={onReorder}
              onUpdate={onUpdateSelected}
            />
          </>
        ) : null}
        <CanvasConfig
          onCanvasPreset={onCanvasPreset}
          onCanvasUpdate={onCanvasUpdate}
          onCommit={onCommit}
          onUpdateBackground={onUpdateBackground}
          scene={scene}
        />
      </>
    );
  }

  return (
    <aside className="better-x-image-editor__inspector">
      <header className="better-x-image-editor__inspector-header">
        <strong>{TOOL_LABELS[tool]}</strong>
        <span>{isSelectionTarget ? "Selection" : "New objects"}</span>
      </header>
      <div className="better-x-image-editor__inspector-content">{content}</div>
    </aside>
  );
}
