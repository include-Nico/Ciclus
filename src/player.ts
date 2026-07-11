export function initPlayer(): void {
  // Sostituisci questi URL con i percorsi reali dei tuoi file audio (.mp3)
  const tracks = [
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3'
  ];
  let currentTrackIndex = 0;
  
  const audio = new Audio(tracks[currentTrackIndex]);
  
  const playBtn = document.getElementById('btn-play') as HTMLButtonElement;
  const nextBtn = document.getElementById('btn-next') as HTMLButtonElement;
  const prevBtn = document.getElementById('btn-prev') as HTMLButtonElement;
  const trackName = document.getElementById('track-name') as HTMLSpanElement;

  const updateTrackInfo = () => {
    trackName.textContent = `Traccia ${currentTrackIndex + 1}`;
  };

  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play();
      playBtn.textContent = '⏸️'; // Icona Pausa
    } else {
      audio.pause();
      playBtn.textContent = '▶️'; // Icona Play
    }
  });

  nextBtn.addEventListener('click', () => {
    currentTrackIndex = (currentTrackIndex + 1) % tracks.length;
    audio.src = tracks[currentTrackIndex];
    audio.play();
    playBtn.textContent = '⏸️';
    updateTrackInfo();
  });

  prevBtn.addEventListener('click', () => {
    currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;
    audio.src = tracks[currentTrackIndex];
    audio.play();
    playBtn.textContent = '⏸️';
    updateTrackInfo();
  });

  updateTrackInfo();
}