import { useTranslate } from "ra-core";
import { lazy, Suspense, useState } from "react";
import { useFormContext } from "react-hook-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

/**
 * The crop dialog is loaded only once someone opens it. It carries
 * `react-cropper`/`cropperjs` (~105 KB) and `react-dropzone`, and this field
 * is rendered by `settings/ProfileSection`, which `root/routeManifest.ts`
 * registers eagerly — so a static import put a photo cropper on the critical
 * path of the login screen.
 *
 * Mounted only while `open`, rather than always-mounted with `open={false}`:
 * an unmounted `React.lazy` never fetches its chunk, which is the entire
 * point. The visible consequence is that a cancelled crop no longer survives
 * until the next open — the dialog starts from the saved value each time,
 * which is what "cancel" ought to mean anyway.
 */
const LazyImageEditorDialog = lazy(async () => {
  const { ImageEditorDialog } = await import("./ImageEditorDialog");
  return { default: ImageEditorDialog };
});

const AVATAR_SIZE = 50;
const IMAGE_SIZE = 200;

const ImageEditorField = (props: ImageEditorFieldProps) => {
  const translate = useTranslate();
  const { getValues } = useFormContext();
  const source = getValues(props.source);
  const imageUrl = source?.src;
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { type = "image", emptyText, linkPosition = "none" } = props;

  const commonProps = {
    src: imageUrl,
    className: `${props.className || ""}`,
  };

  const width = props.width || (type === "avatar" ? AVATAR_SIZE : IMAGE_SIZE);
  const height = props.height || (type === "avatar" ? AVATAR_SIZE : IMAGE_SIZE);

  return (
    <>
      <div
        className={`flex ${
          linkPosition === "right" ? "flex-row" : "flex-col"
        } items-center ${linkPosition === "right" ? "gap-2" : "gap-1"}`}
      >
        {/* `flex`, not the default block: making the preview a real <button>
         * (below) puts an inline-level child in this box, so it sits on a
         * text baseline and the line box reserves descender space beneath
         * it — measured 55px around a 50px avatar. That 5px is a layout
         * shift against the skeleton that holds this row's place while the
         * profile loads, which `settings/ProfileSection.test.tsx` pins.
         * A flex container has no line box, so the accessibility fix costs
         * no height. */}
        <div
          className={`flex rounded ${props.backgroundImageColor ? "p-4" : "p-0"}`}
          style={{
            backgroundColor: props.backgroundImageColor || "transparent",
          }}
        >
          {/* The preview IS the affordance that opens the editor, so it has
           * to be a real control: an onClick on the <Avatar>/<img> left
           * keyboard and screen-reader users with no way to change the
           * picture at all, because the "Change" link below is optional and
           * `linkPosition` defaults to "none". `type="button"` is
           * load-bearing — this field renders inside a react-hook-form
           * <form>, where a bare <button> would submit the whole record. */}
          <button
            type="button"
            onClick={() => setIsDialogOpen(true)}
            aria-label={translate("crm.image_editor.change")}
            className="cursor-pointer rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {props.type === "avatar" ? (
              <Avatar {...commonProps} style={{ width, height }}>
                <AvatarImage src={imageUrl} />
                <AvatarFallback>{emptyText}</AvatarFallback>
              </Avatar>
            ) : (
              <img
                {...commonProps}
                className="object-cover"
                style={{ width, height }}
                alt={translate("crm.image_editor.editable_content", {
                  _: "Editable content",
                })}
              />
            )}
          </button>
        </div>
        {linkPosition !== "none" && (
          <button
            type="button"
            onClick={() => setIsDialogOpen(true)}
            className="inline-flex min-h-11 items-center justify-center text-xs underline hover:no-underline cursor-pointer text-center md:min-h-0"
          >
            {translate("crm.image_editor.change")}
          </button>
        )}
      </div>
      {isDialogOpen && (
        <Suspense fallback={null}>
          <LazyImageEditorDialog
            open
            onClose={() => setIsDialogOpen(false)}
            {...props}
          />
        </Suspense>
      )}
    </>
  );
};

export default ImageEditorField;

export interface ImageEditorFieldProps {
  source: string;
  width?: number;
  height?: number;
  type?: "avatar" | "image";
  onSave?: any;
  linkPosition?: "right" | "bottom" | "none";
  backgroundImageColor?: string;
  className?: string;
  emptyText?: string;
}
