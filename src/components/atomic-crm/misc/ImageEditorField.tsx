import { useFieldValue, useTranslate } from "ra-core";
import { createRef, useCallback, useState } from "react";
import type { ReactCropperElement } from "react-cropper";
import { Cropper } from "react-cropper";
import { useDropzone } from "react-dropzone";
import { useFormContext } from "react-hook-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import "cropperjs/dist/cropper.css";

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
            className="text-xs underline hover:no-underline cursor-pointer text-center"
          >
            {translate("crm.image_editor.change")}
          </button>
        )}
      </div>
      <ImageEditorDialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        {...props}
      />
    </>
  );
};

const ImageEditorDialog = (props: ImageEditorDialogProps) => {
  const translate = useTranslate();
  const { setValue, handleSubmit } = useFormContext();
  const cropperRef = createRef<ReactCropperElement>();
  const initialValue = useFieldValue({ source: props.source });
  const [file, setFile] = useState<File | undefined>();
  const [imageSrc, setImageSrc] = useState<string | undefined>(
    initialValue?.src,
  );
  const onDrop = useCallback((files: File[]) => {
    const preview = URL.createObjectURL(files[0]);
    setFile(files[0]);
    setImageSrc(preview);
  }, []);

  const updateImage = () => {
    const cropper = cropperRef.current?.cropper;
    const croppedImage = cropper?.getCroppedCanvas().toDataURL();
    if (croppedImage) {
      setImageSrc(croppedImage);

      const newFile = file ?? new File([], initialValue?.src);
      setValue(
        props.source,
        {
          src: croppedImage,
          title: newFile.name,
          rawFile: newFile,
        },
        { shouldDirty: true },
      );
      props.onClose();

      if (props.onSave) {
        handleSubmit(props.onSave)();
      }
    }
  };

  const deleteImage = () => {
    setValue(props.source, null, { shouldDirty: true });
    if (props.onSave) {
      handleSubmit(props.onSave)();
    }
    setImageSrc(undefined);
    props.onClose();
  };

  const { getRootProps, getInputProps } = useDropzone({
    accept: { "image/jpeg": [".jpeg", ".png"] },
    onDrop,
    maxFiles: 1,
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onClose}>
      {props.type === "avatar" && (
        <style>
          {`
                        .cropper-crop-box,
                        .cropper-view-box {
                            border-radius: 50%;
                        }
                    `}
        </style>
      )}
      {/* A portrait phone photo makes the cropper taller than the screen,
       * and a centred `fixed` dialog with no height cap then puts Update and
       * Delete below the fold with nothing to scroll. Cap the dialog, scroll
       * it, and cap the cropper itself (`dvh`, never `vh` — browser chrome
       * makes `vh` wrong on a phone) so the footer is always reachable. */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {translate("crm.image_editor.title", {
              _: "Upload and resize image",
            })}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2 justify-center">
          <div
            className="flex flex-row justify-center bg-muted cursor-pointer p-4 border-2 border-dashed border-input rounded-lg hover:bg-muted/80 transition-colors"
            {...getRootProps()}
          >
            <input {...getInputProps()} />
            <p className="text-muted-foreground">
              {translate("crm.image_editor.drop_hint", {
                _: "Drop a file to upload, or click to select it.",
              })}
            </p>
          </div>

          {imageSrc && (
            <Cropper
              ref={cropperRef}
              src={imageSrc}
              aspectRatio={1}
              guides={false}
              cropBoxResizable={false}
              style={{ maxHeight: "45dvh", width: "100%" }}
            />
          )}
        </div>

        <DialogFooter className="flex justify-between w-full">
          <Button type="button" onClick={updateImage}>
            {translate("crm.image_editor.update_image")}
          </Button>
          <Button type="button" variant="destructive" onClick={deleteImage}>
            {translate("ra.action.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

export interface ImageEditorDialogProps extends ImageEditorFieldProps {
  open: boolean;
  onClose: () => void;
}
