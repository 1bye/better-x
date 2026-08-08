// biome-ignore-all lint/performance/noJsxPropsBind: Native text events must remain attached to the editing surface.
import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
  useLayoutEffect,
  useRef,
} from "react";
import type { TextSceneObject } from "../lib/image-editor";

interface TextObjectEditorProps {
  readonly initialSelection: number;
  readonly object: TextSceneObject;
  readonly onBlur: (nextTarget: EventTarget | null) => void;
  readonly onChange: (text: string) => void;
  readonly onFinish: () => void;
  readonly style: CSSProperties;
}

export function TextObjectEditor({
  initialSelection,
  onBlur,
  object,
  onChange,
  onFinish,
  style,
}: TextObjectEditorProps): ReactElement {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    editor.focus();
    editor.setSelectionRange(initialSelection, initialSelection);
  }, [initialSelection]);

  const stopEditorKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onFinish();
    }
  };
  const finishOnBlur = (event: FocusEvent<HTMLTextAreaElement>): void =>
    onBlur(event.relatedTarget);
  const stopEditorEvent = (event: SyntheticEvent): void =>
    event.stopPropagation();

  return (
    <textarea
      aria-label={`Edit ${object.name}`}
      aria-multiline="true"
      autoCapitalize="sentences"
      className="better-x-image-editor__text-editor"
      defaultValue={object.text}
      onBeforeInput={stopEditorEvent}
      onBlur={finishOnBlur}
      onChange={(event) => {
        event.stopPropagation();
        onChange(event.currentTarget.value);
      }}
      onClick={stopEditorEvent}
      onCompositionEnd={stopEditorEvent}
      onCompositionStart={stopEditorEvent}
      onCompositionUpdate={stopEditorEvent}
      onContextMenu={stopEditorEvent}
      onCopy={stopEditorEvent}
      onCut={stopEditorEvent}
      onDoubleClick={stopEditorEvent}
      onKeyDown={stopEditorKey}
      onKeyUp={stopEditorEvent}
      onPaste={stopEditorEvent}
      onPointerDown={stopEditorEvent}
      onPointerUp={stopEditorEvent}
      ref={editorRef}
      spellCheck
      style={style}
    />
  );
}
