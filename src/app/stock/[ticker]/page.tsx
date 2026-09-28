import { StockView } from "./StockView";

export default async function StockPage({ params }: PageProps<"/stock/[ticker]">) {
  const { ticker } = await params;
  return <StockView ticker={decodeURIComponent(ticker).toUpperCase()} />;
}
