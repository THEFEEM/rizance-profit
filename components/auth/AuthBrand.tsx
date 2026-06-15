import Image from "next/image";

/** Centered brand mark + title. Swap logo by changing LOGO_SRC only. */
const LOGO_SRC = "/Logo.png";

export function AuthBrand() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-[15px] border-[0.5px] border-rz-logo-border bg-rz-logo-bg">
        <Image
          src={LOGO_SRC}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 object-contain"
          priority
        />
      </div>
      <h1 className="mt-4 text-[22px] font-medium tracking-[-0.3px] text-rz-text">Rizance</h1>
      <p className="mt-1 text-[13px] text-rz-hint">know your real profit</p>
    </div>
  );
}
