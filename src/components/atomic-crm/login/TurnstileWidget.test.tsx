import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TurnstileWidget, type TurnstileWidgetHandle } from "./TurnstileWidget";
import { loadTurnstile, type TurnstileRenderOptions } from "./turnstileLoader";

vi.mock("./turnstileLoader", () => ({
  loadTurnstile: vi.fn(),
}));

const mockedLoadTurnstile = vi.mocked(loadTurnstile);

describe("TurnstileWidget", () => {
  it("renders the widget and forwards the solved token once the script loads", async () => {
    // Arrange
    const render_ = vi.fn(
      (_container: HTMLElement, _options: TurnstileRenderOptions) => "widget-1",
    );
    mockedLoadTurnstile.mockResolvedValue({
      render: render_,
      reset: vi.fn(),
      remove: vi.fn(),
    });
    const onToken = vi.fn();

    // Act
    render(<TurnstileWidget siteKey="test-site-key" onToken={onToken} />);
    await vi.waitFor(() => {
      expect(render_).toHaveBeenCalled();
    });
    const options = render_.mock.calls[0][1];
    options.callback("solved-token");

    // Assert
    expect(onToken).toHaveBeenCalledWith("solved-token");
    expect(render_).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sitekey: "test-site-key" }),
    );
  });

  it("reports a null token when the expired callback fires", async () => {
    // Arrange
    const render_ = vi.fn(
      (_container: HTMLElement, _options: TurnstileRenderOptions) => "widget-2",
    );
    mockedLoadTurnstile.mockResolvedValue({
      render: render_,
      reset: vi.fn(),
      remove: vi.fn(),
    });
    const onToken = vi.fn();

    // Act
    render(<TurnstileWidget siteKey="test-site-key" onToken={onToken} />);
    await vi.waitFor(() => {
      expect(render_).toHaveBeenCalled();
    });
    const options = render_.mock.calls[0][1];
    options["expired-callback"]?.();

    // Assert
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it("reports a null token instead of crashing when the script fails to load", async () => {
    // Arrange
    mockedLoadTurnstile.mockRejectedValue(new Error("blocked by an extension"));
    const onToken = vi.fn();

    // Act
    render(<TurnstileWidget siteKey="test-site-key" onToken={onToken} />);

    // Assert
    await vi.waitFor(() => {
      expect(onToken).toHaveBeenCalledWith(null);
    });
  });

  it("resets the underlying widget through the imperative handle", async () => {
    // Arrange
    const reset = vi.fn();
    mockedLoadTurnstile.mockResolvedValue({
      render: vi.fn().mockReturnValue("widget-3"),
      reset,
      remove: vi.fn(),
    });
    const ref = createRef<TurnstileWidgetHandle>();

    // Act
    render(
      <TurnstileWidget ref={ref} siteKey="test-site-key" onToken={vi.fn()} />,
    );
    await vi.waitFor(() => {
      expect(ref.current).not.toBeNull();
    });
    ref.current?.reset();

    // Assert
    expect(reset).toHaveBeenCalledWith("widget-3");
  });
});
