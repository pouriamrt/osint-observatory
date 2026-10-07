// Automated zoom/pan checks never request public community tiles.
export const streetTileFixture = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e4eadb"/><path d="M0 70H256M80 0V256M0 180L256 120" stroke="#bbc3b0" stroke-width="12"/><path d="M0 70H256M80 0V256M0 180L256 120" stroke="#fff" stroke-width="8"/><text x="110" y="60" font-family="sans-serif" font-size="12" fill="#475644">Test street</text></svg>';
export async function mockStreetTiles(surface) {
  await surface.route('https://tile.openstreetmap.org/**', route => route.fulfill({ contentType: 'image/svg+xml', body: streetTileFixture }));
}
