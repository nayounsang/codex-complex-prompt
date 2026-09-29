import { Component } from 'react';

interface MermaidPreviewErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly resetKey: string;
}

interface MermaidPreviewErrorBoundaryState {
  readonly hasError: boolean;
  readonly resetKey: string;
}

export class MermaidPreviewErrorBoundary extends Component<
  MermaidPreviewErrorBoundaryProps,
  MermaidPreviewErrorBoundaryState
> {
  public override state: MermaidPreviewErrorBoundaryState = {
    hasError: false,
    resetKey: this.props.resetKey,
  };

  public static getDerivedStateFromError(): Pick<
    MermaidPreviewErrorBoundaryState,
    'hasError'
  > {
    return { hasError: true };
  }

  public static getDerivedStateFromProps(
    props: MermaidPreviewErrorBoundaryProps,
    state: MermaidPreviewErrorBoundaryState,
  ): MermaidPreviewErrorBoundaryState | null {
    return props.resetKey === state.resetKey
      ? null
      : { hasError: false, resetKey: props.resetKey };
  }

  public override render(): React.ReactNode {
    if (this.state.hasError) {
      return <span role="status">Diagram preview unavailable</span>;
    }
    return this.props.children;
  }
}
