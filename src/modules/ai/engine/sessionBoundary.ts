type SessionDisposer = () => void;

let disposer: SessionDisposer | undefined;
let generation = 0;

export function registerAiSessionDisposer(next: SessionDisposer): () => void {
  disposer = next;
  return () => {
    if (disposer === next) disposer = undefined;
  };
}

export function disposeAiSession(): void {
  generation += 1;
  disposer?.();
}

export function aiSessionGeneration(): number {
  return generation;
}
