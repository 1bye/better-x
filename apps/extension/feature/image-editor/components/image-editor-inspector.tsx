// biome-ignore-all lint/performance/noJsxPropsBind: Field updates stay beside their controls, which are not memoized.
import { Button } from "@better-x/ui/components/button";
import { Kbd } from "@better-x/ui/components/kbd";
import { ArrowDownIcon } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowUpIcon } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { CropIcon } from "@phosphor-icons/react/dist/csr/Crop";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import type { ReactElement, ReactNode } from "react";
import type {
  ImageSceneObject,
  SceneBackground,
  SceneDocument,
  SceneObject,
  TextSceneObject,
} from "../lib/image-editor";

type SceneObjectUpdate = (object: SceneObject) => SceneObject;

export interface ImageEditorInspectorProps {
  readonly isCropping: boolean;
  readonly onCanvasPreset: (ratio: number | null) => void;
  readonly onCanvasUpdate: (
    update: Partial<Pick<SceneDocument, "height" | "width">>
  ) => void;
  readonly onCommit: () => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onReorder: (direction: -1 | 1) => void;
  readonly onToggleCrop: () => void;
  readonly onUpdateBackground: (update: Partial<SceneBackground>) => void;
  readonly onUpdateSelected: (update: SceneObjectUpdate) => void;
  readonly scene: SceneDocument;
  readonly selected: SceneObject | null;
}

interface ValueControlProps {
  readonly label: string;
  readonly onCommit: () => void;
  readonly onValue: (value: number) => void;
  readonly value: number;
}

interface NumberControlProps extends ValueControlProps {
  readonly maximum?: number;
  readonly minimum?: number;
  readonly step?: number;
}

interface RangeControlProps extends ValueControlProps {
  readonly maximum: number;
  readonly minimum: number;
  readonly step?: number;
}

interface SelectControlProps {
  readonly label: string;
  readonly onCommit: () => void;
  readonly onValue: (value: string) => void;
  readonly options: readonly { label: string; value: string }[];
  readonly value: string;
}

const getObjectLabel = (object: SceneObject): string =>
  object.kind === "rectangle"
    ? "Rectangle"
    : object.kind[0]?.toUpperCase() + object.kind.slice(1);

function InspectorSection({
  children,
  open = true,
  title,
}: {
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly title: string;
}): ReactElement {
  return (
    <details className="better-x-image-editor__inspector-section" open={open}>
      <summary>{title}</summary>
      {children}
    </details>
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
}: NumberControlProps): ReactElement {
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
      value={value.slice(0, 7)}
    />
  );
}

function SelectControl({
  label,
  onCommit,
  onValue,
  options,
  value,
}: SelectControlProps): ReactElement {
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

function TransformInspector({
  object,
  onCommit,
  onUpdate,
}: {
  readonly object: SceneObject;
  readonly onCommit: () => void;
  readonly onUpdate: (update: SceneObjectUpdate) => void;
}): ReactElement {
  const values: readonly {
    key: "height" | "rotation" | "width" | "x" | "y";
    label: string;
    minimum?: number;
  }[] = [
    { key: "x", label: "X" },
    { key: "y", label: "Y" },
    { key: "width", label: "W", minimum: 12 },
    { key: "height", label: "H", minimum: 12 },
    { key: "rotation", label: "°" },
  ];

  return (
    <InspectorSection open={false} title="Transform">
      <div className="better-x-image-editor__field-grid">
        {values.map((entry) => (
          <Field key={entry.key} label={entry.label}>
            <NumberControl
              label={entry.label}
              minimum={entry.minimum}
              onCommit={onCommit}
              onValue={(value) =>
                onUpdate((candidate) => ({
                  ...candidate,
                  [entry.key]: value,
                }))
              }
              value={object[entry.key]}
            />
          </Field>
        ))}
      </div>
      <Field label="Opacity">
        <RangeControl
          label="Opacity"
          maximum={100}
          minimum={0}
          onCommit={onCommit}
          onValue={(value) =>
            onUpdate((candidate) => ({
              ...candidate,
              opacity: value / 100,
            }))
          }
          value={Math.round(object.opacity * 100)}
        />
      </Field>
    </InspectorSection>
  );
}

function ImageInspector({
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
    <InspectorSection title="Image">
      <Button
        className="better-x-image-editor__inspector-action"
        onClick={onToggleCrop}
        size="sm"
        type="button"
        variant="ghost"
      >
        <CropIcon
          aria-hidden
          className="better-x-image-editor__icon"
          weight="regular"
        />
        <span className="better-x-image-editor__button-label">
          {isCropping ? "Finish crop" : "Crop image"}
        </span>
        <Kbd>C</Kbd>
      </Button>
      <Field label="Corner radius">
        <RangeControl
          label="Image corner radius"
          maximum={Math.round(Math.min(object.width, object.height) / 2)}
          minimum={0}
          onCommit={onCommit}
          onValue={(value) =>
            onUpdate((candidate) =>
              candidate.kind === "image"
                ? { ...candidate, radius: value }
                : candidate
            )
          }
          value={Math.round(object.radius)}
        />
      </Field>
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
    </InspectorSection>
  );
}

function TextInspector({
  object,
  onCommit,
  onUpdate,
}: {
  readonly object: TextSceneObject;
  readonly onCommit: () => void;
  readonly onUpdate: (update: SceneObjectUpdate) => void;
}): ReactElement {
  const hasBackground = object.background !== "transparent";
  return (
    <InspectorSection title="Text">
      <textarea
        aria-label="Text content"
        className="better-x-image-editor__textarea"
        onBlur={onCommit}
        onChange={(event) =>
          onUpdate((candidate) =>
            candidate.kind === "text"
              ? { ...candidate, text: event.currentTarget.value }
              : candidate
          )
        }
        rows={3}
        value={object.text}
      />
      <Field label="Font">
        <SelectControl
          label="Font family"
          onCommit={onCommit}
          onValue={(value) =>
            onUpdate((candidate) =>
              candidate.kind === "text"
                ? { ...candidate, fontFamily: value }
                : candidate
            )
          }
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
          value={object.fontFamily}
        />
      </Field>
      <div className="better-x-image-editor__field-grid">
        <Field label="Size">
          <NumberControl
            label="Font size"
            maximum={500}
            minimum={6}
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "text"
                  ? { ...candidate, fontSize: value }
                  : candidate
              )
            }
            value={object.fontSize}
          />
        </Field>
        <Field label="Weight">
          <SelectControl
            label="Font weight"
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "text"
                  ? { ...candidate, fontWeight: Number(value) }
                  : candidate
              )
            }
            options={[
              { label: "Regular", value: "400" },
              { label: "Medium", value: "500" },
              { label: "Semibold", value: "600" },
              { label: "Bold", value: "700" },
              { label: "Black", value: "900" },
            ]}
            value={String(object.fontWeight)}
          />
        </Field>
      </div>
      <Field label="Line height">
        <RangeControl
          label="Line height"
          maximum={2}
          minimum={0.7}
          onCommit={onCommit}
          onValue={(value) =>
            onUpdate((candidate) =>
              candidate.kind === "text"
                ? { ...candidate, lineHeight: value }
                : candidate
            )
          }
          step={0.05}
          value={object.lineHeight}
        />
      </Field>
      <Field label="Letter spacing">
        <RangeControl
          label="Letter spacing"
          maximum={40}
          minimum={-10}
          onCommit={onCommit}
          onValue={(value) =>
            onUpdate((candidate) =>
              candidate.kind === "text"
                ? { ...candidate, letterSpacing: value }
                : candidate
            )
          }
          step={0.5}
          value={object.letterSpacing}
        />
      </Field>
      <Field label="Align">
        <SelectControl
          label="Text alignment"
          onCommit={onCommit}
          onValue={(value) => {
            const align: CanvasTextAlign =
              value === "center" || value === "right" ? value : "left";
            onUpdate((candidate) =>
              candidate.kind === "text" ? { ...candidate, align } : candidate
            );
          }}
          options={[
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
            { label: "Right", value: "right" },
          ]}
          value={object.align}
        />
      </Field>
      <Field label="Color">
        <ColorControl
          label="Text color"
          onCommit={onCommit}
          onValue={(value) =>
            onUpdate((candidate) =>
              candidate.kind === "text"
                ? { ...candidate, color: value }
                : candidate
            )
          }
          value={object.color}
        />
      </Field>
      <Field label="Background">
        <ToggleControl
          checked={hasBackground}
          label="Text background"
          onCommit={onCommit}
          onValue={(enabled) =>
            onUpdate((candidate) =>
              candidate.kind === "text"
                ? {
                    ...candidate,
                    background: enabled ? "#0f1419" : "transparent",
                  }
                : candidate
            )
          }
        />
      </Field>
      {hasBackground ? (
        <Field label="Background color">
          <ColorControl
            label="Text background color"
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "text"
                  ? { ...candidate, background: value }
                  : candidate
              )
            }
            value={object.background}
          />
        </Field>
      ) : null}
      <Field label="Shadow">
        <RangeControl
          label="Text shadow"
          maximum={80}
          minimum={0}
          onCommit={onCommit}
          onValue={(value) =>
            onUpdate((candidate) =>
              candidate.kind === "text"
                ? { ...candidate, shadow: value }
                : candidate
            )
          }
          value={object.shadow}
        />
      </Field>
    </InspectorSection>
  );
}

function ShapeInspector({
  object,
  onCommit,
  onUpdate,
}: {
  readonly object: Exclude<SceneObject, ImageSceneObject | TextSceneObject>;
  readonly onCommit: () => void;
  readonly onUpdate: (update: SceneObjectUpdate) => void;
}): ReactElement {
  if (object.kind === "rectangle") {
    return (
      <InspectorSection title="Rectangle">
        <Field label="Fill">
          <ColorControl
            label="Rectangle fill"
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "rectangle"
                  ? { ...candidate, fill: value }
                  : candidate
              )
            }
            value={object.fill}
          />
        </Field>
        <Field label="Stroke">
          <ColorControl
            label="Rectangle stroke"
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "rectangle"
                  ? { ...candidate, stroke: value }
                  : candidate
              )
            }
            value={object.stroke}
          />
        </Field>
        <Field label="Stroke width">
          <RangeControl
            label="Rectangle stroke width"
            maximum={40}
            minimum={0}
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "rectangle"
                  ? { ...candidate, strokeWidth: value }
                  : candidate
              )
            }
            value={object.strokeWidth}
          />
        </Field>
        <Field label="Radius">
          <RangeControl
            label="Rectangle radius"
            maximum={Math.round(Math.min(object.width, object.height) / 2)}
            minimum={0}
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "rectangle"
                  ? { ...candidate, radius: value }
                  : candidate
              )
            }
            value={object.radius}
          />
        </Field>
      </InspectorSection>
    );
  }
  if (object.kind === "arrow") {
    return (
      <InspectorSection title="Arrow">
        <Field label="Color">
          <ColorControl
            label="Arrow color"
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "arrow"
                  ? { ...candidate, stroke: value }
                  : candidate
              )
            }
            value={object.stroke}
          />
        </Field>
        <Field label="Width">
          <RangeControl
            label="Arrow stroke width"
            maximum={40}
            minimum={1}
            onCommit={onCommit}
            onValue={(value) =>
              onUpdate((candidate) =>
                candidate.kind === "arrow"
                  ? { ...candidate, strokeWidth: value }
                  : candidate
              )
            }
            value={object.strokeWidth}
          />
        </Field>
      </InspectorSection>
    );
  }
  return (
    <InspectorSection title="Blur">
      <Field label="Strength">
        <RangeControl
          label="Blur strength"
          maximum={80}
          minimum={2}
          onCommit={onCommit}
          onValue={(value) =>
            onUpdate((candidate) =>
              candidate.kind === "blur"
                ? { ...candidate, strength: value }
                : candidate
            )
          }
          value={object.strength}
        />
      </Field>
    </InspectorSection>
  );
}

function ObjectInspector({
  isCropping,
  object,
  onCommit,
  onToggleCrop,
  onUpdate,
}: {
  readonly isCropping: boolean;
  readonly object: SceneObject;
  readonly onCommit: () => void;
  readonly onToggleCrop: () => void;
  readonly onUpdate: (update: SceneObjectUpdate) => void;
}): ReactElement {
  if (object.kind === "image") {
    return (
      <ImageInspector
        isCropping={isCropping}
        object={object}
        onCommit={onCommit}
        onToggleCrop={onToggleCrop}
        onUpdate={onUpdate}
      />
    );
  }
  if (object.kind === "text") {
    return (
      <TextInspector object={object} onCommit={onCommit} onUpdate={onUpdate} />
    );
  }
  return (
    <ShapeInspector object={object} onCommit={onCommit} onUpdate={onUpdate} />
  );
}

function ArrangeInspector({
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
    <InspectorSection open={false} title="Arrange">
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
          className="better-x-image-editor__inspector-action"
          onClick={() => onReorder(1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowUpIcon
            aria-hidden
            className="better-x-image-editor__icon"
            weight="regular"
          />
          <span className="better-x-image-editor__button-label">
            Bring forward
          </span>
        </Button>
        <Button
          className="better-x-image-editor__inspector-action"
          onClick={() => onReorder(-1)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowDownIcon
            aria-hidden
            className="better-x-image-editor__icon"
            weight="regular"
          />
          <span className="better-x-image-editor__button-label">
            Send backward
          </span>
        </Button>
        <Button
          className="better-x-image-editor__inspector-action"
          onClick={onDuplicate}
          size="sm"
          type="button"
          variant="ghost"
        >
          <CopyIcon
            aria-hidden
            className="better-x-image-editor__icon"
            weight="regular"
          />
          <span className="better-x-image-editor__button-label">Duplicate</span>
        </Button>
        <Button
          className="better-x-image-editor__inspector-action"
          onClick={onDelete}
          size="sm"
          type="button"
          variant="ghost"
        >
          <TrashIcon
            aria-hidden
            className="better-x-image-editor__icon"
            weight="regular"
          />
          <span className="better-x-image-editor__button-label">Delete</span>
        </Button>
      </div>
    </InspectorSection>
  );
}

function CanvasInspector({
  onCanvasPreset,
  onCanvasUpdate,
  onCommit,
  onUpdateBackground,
  scene,
}: Pick<
  ImageEditorInspectorProps,
  | "onCanvasPreset"
  | "onCanvasUpdate"
  | "onCommit"
  | "onUpdateBackground"
  | "scene"
>): ReactElement {
  return (
    <>
      <InspectorSection title="Canvas">
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
          <Field label="Width">
            <NumberControl
              label="Canvas width"
              maximum={16_384}
              minimum={64}
              onCommit={onCommit}
              onValue={(width) => onCanvasUpdate({ width })}
              value={scene.width}
            />
          </Field>
          <Field label="Height">
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
      </InspectorSection>
      <InspectorSection title="Background">
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
                onValue={(value) =>
                  onUpdateBackground({
                    type: value === "solid" ? "solid" : "gradient",
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
                ["Corner radius", "radius", 240],
                ["Shadow", "shadow", 160],
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
      </InspectorSection>
    </>
  );
}

export function ImageEditorInspector({
  isCropping,
  onCanvasPreset,
  onCanvasUpdate,
  onCommit,
  onDelete,
  onDuplicate,
  onReorder,
  onToggleCrop,
  onUpdateBackground,
  onUpdateSelected,
  scene,
  selected,
}: ImageEditorInspectorProps): ReactElement {
  return (
    <aside className="better-x-image-editor__inspector">
      <header className="better-x-image-editor__inspector-header">
        <strong>{selected ? selected.name : "Canvas"}</strong>
        <span>{selected ? getObjectLabel(selected) : "Document"}</span>
      </header>
      <div className="better-x-image-editor__inspector-content">
        {selected ? (
          <>
            <ObjectInspector
              isCropping={isCropping}
              object={selected}
              onCommit={onCommit}
              onToggleCrop={onToggleCrop}
              onUpdate={onUpdateSelected}
            />
            <TransformInspector
              object={selected}
              onCommit={onCommit}
              onUpdate={onUpdateSelected}
            />
            <ArrangeInspector
              object={selected}
              onCommit={onCommit}
              onDelete={onDelete}
              onDuplicate={onDuplicate}
              onReorder={onReorder}
              onUpdate={onUpdateSelected}
            />
          </>
        ) : (
          <CanvasInspector
            onCanvasPreset={onCanvasPreset}
            onCanvasUpdate={onCanvasUpdate}
            onCommit={onCommit}
            onUpdateBackground={onUpdateBackground}
            scene={scene}
          />
        )}
      </div>
    </aside>
  );
}
