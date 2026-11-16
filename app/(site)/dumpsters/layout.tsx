import s from "../site.module.css";

/** DropWise: buttons and accents in the logo's orange (.dropwise). */
export default function DropWiseLayout({ children }: LayoutProps<"/dumpsters">) {
  return <div className={s.dropwise}>{children}</div>;
}
