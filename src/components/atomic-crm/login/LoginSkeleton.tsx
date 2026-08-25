import { Skeleton } from "@/components/ui/skeleton";

export const LoginSkeleton = () => {
  return (
    // `dvh`, not `vh`: a mobile browser measures `100vh` as though the
    // collapsing URL bar were not there, so this came out taller than the
    // visible area — the centred placeholder sat low and pushed a scrollbar
    // for the moment it was on screen. The `pt-8` compounded it and is not
    // needed once the column is the full height and centres its own content.
    // `min-h-[inherit]` is what passes that height down; `h-full` cannot,
    // because a percentage height needs a definite parent height and a
    // `min-height` alone does not give one.
    <div className="max-w-screen-xl mx-auto min-h-[100dvh]">
      <div className="min-h-[inherit]">
        <div className="max-w-sm mx-auto min-h-[inherit] flex flex-col justify-center gap-8">
          <Skeleton className="w-full h-[100px]" />
          <Skeleton className="w-4/5 h-[50px]" />
          <Skeleton className="w-full h-9" />
          <Skeleton className="w-full h-9" />
          <Skeleton className="w-full h-9" />
          <Skeleton className="w-2/5 h-9" />
        </div>
      </div>
    </div>
  );
};
