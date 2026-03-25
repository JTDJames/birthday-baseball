import { carouselImagePaths } from "./photos-collage-paths.js";

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function buildBackgroundCarousel(container, shuffledImagePaths) {
  const visibleTilesPerRow = 9;
  const rowCount = 5;
  const grid = document.createElement("div");
  grid.className = "bg-carousel-grid";
  container.appendChild(grid);

  const makeTile = (path) => {
    const tile = document.createElement("div");
    tile.className = "bg-carousel-tile";
    tile.style.backgroundImage = `url("${encodeURI(path)}")`;
    return tile;
  };

  for (let rowIdx = 0; rowIdx < rowCount; rowIdx += 1) {
    const row = document.createElement("div");
    row.className = `bg-carousel-row${rowIdx % 2 ? " reverse" : ""}`;
    row.style.setProperty("--row-duration", `${74 + rowIdx * 9}s`);

    for (let copyIdx = 0; copyIdx < 3; copyIdx += 1) {
      for (let colIdx = 0; colIdx < visibleTilesPerRow; colIdx += 1) {
        const imageIdx =
          (rowIdx * visibleTilesPerRow + colIdx + copyIdx * 7) %
          shuffledImagePaths.length;
        row.appendChild(makeTile(shuffledImagePaths[imageIdx]));
      }
    }

    grid.appendChild(row);
  }
}

function buildPhotosFrame(stripEl, shuffledImagePaths) {
  const tilesPerSegment = 10;
  const makeTile = (path) => {
    const tile = document.createElement("div");
    tile.className = "photos-frame-tile";
    tile.style.backgroundImage = `url("${encodeURI(path)}")`;
    return tile;
  };

  const row = document.createElement("div");
  row.className = "photos-frame-row";
  row.style.setProperty("--row-duration", "88s");

  for (let copyIdx = 0; copyIdx < 3; copyIdx += 1) {
    for (let colIdx = 0; colIdx < tilesPerSegment; colIdx += 1) {
      const imageIdx =
        (copyIdx * tilesPerSegment + colIdx) % shuffledImagePaths.length;
      row.appendChild(makeTile(shuffledImagePaths[imageIdx]));
    }
  }

  stripEl.appendChild(row);
}

(function initCollage() {
  if (!carouselImagePaths.length) return;

  const shuffledImagePaths = [...carouselImagePaths];
  shuffleInPlace(shuffledImagePaths);

  const carouselContainer = document.getElementById("bgCarousel");
  if (carouselContainer) {
    buildBackgroundCarousel(carouselContainer, shuffledImagePaths);
  }

  const stripEl = document.getElementById("photosFrameStrip");
  if (stripEl) {
    buildPhotosFrame(stripEl, shuffledImagePaths);
  }
})();
