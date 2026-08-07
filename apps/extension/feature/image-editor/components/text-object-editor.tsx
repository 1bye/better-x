// biome-ignore-all lint/performance/noJsxPropsBind: Native text events must remain attached to the editing surface.
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  useLayoutEffect,
  useRef,
} from "react";
import type { TextSceneObject } from "../lib/image-editor";

interface TextObjectEditorProps {
  readonly object: TextSceneObject;
  readonly onChange: (text: string) => void;
  readonly onFinish: () => void;
  readonly style: CSSProperties;
}

export function TextObjectEditor({
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
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }, []);

  const stopEditorKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onFinish();
    }
  };
  const finishOnBlur = (): void => onFinish();

  return (
    <textarea
      aria-label={`Edit ${object.name}`}
      aria-multiline="true"
      autoCapitalize="sentences"
      className="better-x-image-editor__text-editor"
      defaultValue={object.text}
      onBlur={finishOnBlur}
      onChange={(event) => onChange(event.currentTarget.value)}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={stopEditorKey}
      onKeyUp={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      ref={editorRef}
      spellCheck
      style={style}
    />
  );
}
