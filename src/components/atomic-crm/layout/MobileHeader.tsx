const MobileHeader = ({ children }: { children: React.ReactNode }) => {
  return (
    <header className="fixed top-0 left-0 right-0 z-10 flex h-(--mobile-header-h) w-full items-center justify-between bg-secondary px-4">
      {children}
    </header>
  );
};

export default MobileHeader;
