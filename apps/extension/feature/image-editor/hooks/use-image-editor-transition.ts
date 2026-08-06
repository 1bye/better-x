import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type EditorViewTransform,
  formatEditorViewTransform,
  getSharedElementFrame,
  type ImageEditorOrigin,
} from "../lib/image-editor-viewport";

const OPEN_DURATION = 420;
const CLOSE_DURATION = 320;
const FADE_CLOSE_DURATION = 180;
const MOTION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const OPEN_CLIP_PATH = "inset(0px 0px 0px 0px round 0px)";

export type ImageEditorTransitionState =
  | "closed"
  | "closing"
  | "open"
  | "opening";

interface CloseImageEditorOptions {
  readonly immediate?: boolean;
  readonly reverse?: boolean;
}

interface UseImageEditorTransitionOptions {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly isReady: boolean;
  readonly onClosed: () => void;
  readonly origin: ImageEditorOrigin | null;
  readonly sessionKey: object | null;
  readonly stageRef: RefObject<HTMLDivElement | null>;
  readonly view: EditorViewTransform;
}

interface UseImageEditorTransitionResult {
  readonly close: (options?: CloseImageEditorOptions) => void;
  readonly state: ImageEditorTransitionState;
}

const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const settleAnimation = (animation: Animation, callback: () => void): void => {
  animation.finished.then(callback).catch(() => {
    // Cancelling an obsolete transition rejects `finished`.
  });
};

export const useImageEditorTransition = ({
  canvasRef,
  isReady,
  onClosed,
  origin,
  sessionKey,
  stageRef,
  view,
}: UseImageEditorTransitionOptions): UseImageEditorTransitionResult => {
  const [state, setState] = useState<ImageEditorTransitionState>("closed");
  const animationRef = useRef<Animation | null>(null);
  const openedSessionRef = useRef<object | null>(null);
  const originRef = useRef(origin);
  const stateRef = useRef(state);
  originRef.current = origin;
  stateRef.current = state;

  const cancelAnimation = useCallback((): void => {
    animationRef.current?.cancel();
    animationRef.current = null;
  }, []);

  useLayoutEffect(() => {
    if (!sessionKey) {
      openedSessionRef.current = null;
      setState("closed");
      return;
    }
    if (!isReady || openedSessionRef.current === sessionKey) {
      return;
    }

    openedSessionRef.current = sessionKey;
    cancelAnimation();
    setState("opening");
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!(canvas && stage)) {
      origin?.setVisible(false);
      setState("open");
      return;
    }

    const finalTransform = formatEditorViewTransform(view);
    const snapshot = origin?.getSnapshot() ?? null;
    origin?.setVisible(false);
    if (prefersReducedMotion()) {
      setState("open");
      return;
    }

    const stageBounds = stage.getBoundingClientRect();
    const fromFrame = snapshot
      ? getSharedElementFrame({
          canvasHeight: canvas.height,
          canvasWidth: canvas.width,
          origin: snapshot,
          stageLeft: stageBounds.left,
          stageTop: stageBounds.top,
          view,
        })
      : null;
    const animation = canvas.animate(
      [
        {
          borderRadius: fromFrame?.borderRadius ?? "16px",
          clipPath: fromFrame?.clipPath ?? OPEN_CLIP_PATH,
          opacity: snapshot ? 1 : 0,
          transform: fromFrame?.transform ?? `${finalTransform} scale(0.96)`,
        },
        {
          borderRadius: "0px",
          clipPath: OPEN_CLIP_PATH,
          opacity: 1,
          transform: finalTransform,
        },
      ],
      {
        duration: OPEN_DURATION,
        easing: MOTION_EASING,
        fill: "both",
      }
    );
    animationRef.current = animation;
    settleAnimation(animation, () => {
      if (animationRef.current !== animation) {
        return;
      }
      animation.cancel();
      animationRef.current = null;
      setState("open");
    });
  }, [cancelAnimation, canvasRef, isReady, origin, sessionKey, stageRef, view]);

  const close = useCallback(
    ({
      immediate = false,
      reverse = true,
    }: CloseImageEditorOptions = {}): void => {
      if (stateRef.current === "closing") {
        return;
      }
      const currentOrigin = originRef.current;
      const finish = (): void => {
        currentOrigin?.setVisible(true);
        cancelAnimation();
        onClosed();
      };
      const canvas = canvasRef.current;
      const stage = stageRef.current;
      if (immediate || prefersReducedMotion() || !(canvas && stage)) {
        finish();
        return;
      }

      cancelAnimation();
      stateRef.current = "closing";
      setState("closing");
      const finalTransform = formatEditorViewTransform(view);
      const snapshot = reverse ? (currentOrigin?.getSnapshot() ?? null) : null;
      const stageBounds = stage.getBoundingClientRect();
      const toFrame = snapshot
        ? getSharedElementFrame({
            canvasHeight: canvas.height,
            canvasWidth: canvas.width,
            origin: snapshot,
            stageLeft: stageBounds.left,
            stageTop: stageBounds.top,
            view,
          })
        : null;
      const animation = canvas.animate(
        [
          {
            borderRadius: "0px",
            clipPath: OPEN_CLIP_PATH,
            opacity: 1,
            transform: finalTransform,
          },
          {
            borderRadius: toFrame?.borderRadius ?? "12px",
            clipPath: toFrame?.clipPath ?? OPEN_CLIP_PATH,
            opacity: snapshot ? 1 : 0,
            transform: toFrame?.transform ?? `${finalTransform} scale(0.98)`,
          },
        ],
        {
          duration: snapshot ? CLOSE_DURATION : FADE_CLOSE_DURATION,
          easing: MOTION_EASING,
          fill: "both",
        }
      );
      animationRef.current = animation;
      settleAnimation(animation, finish);
    },
    [cancelAnimation, canvasRef, onClosed, stageRef, view]
  );

  useLayoutEffect(
    () => () => {
      originRef.current?.setVisible(true);
      cancelAnimation();
    },
    [cancelAnimation]
  );

  return {
    close,
    state: isReady && state === "closed" ? "opening" : state,
  };
};
