import { useFieldValue, useTranslate } from "ra-core";
import { createRef, useCallback, useState } from "react";
import type { ReactCropperElement } from "react-cropper";
import { Cropper } from "react-cropper";
import { useDropzone } from "react-dropzone";
import { useFormContext } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import "cropperjs/dist/cropper.css";

import type { ImageEditorFieldProps } from "./ImageEditorField";

/**
 * The crop dialog, split out from `ImageEditorField` so it can be
 * `React.lazy`-loaded — and it is the ONLY module in this pair that may import
 * `react-cropper`.
 *
 * `cropperjs` is ~105 KB and exists for one interaction: cropping a profile
 * picture. It was reaching every visitor's first page load, because
 * `settings/ProfileSection` imports `ImageEditorField` and Settings is
 * registered eagerly in `root/routeManifest.ts`. Nobody cropping a photo is
 * on the login screen; nobody on the login screen is cropping a photo.
 *
 * Keep the cropper import here. Re-adding it to `ImageEditorField.tsx` — even
 * as a type — puts it back on that path.
 */
export const ImageEditorDialog = (props: ImageEditorDialogProps) => {
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

export interface ImageEditorDialogProps extends ImageEditorFieldProps {
  open: boolean;
  onClose: () => void;
}
