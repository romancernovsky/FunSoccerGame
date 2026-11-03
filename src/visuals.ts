const TAU = Math.PI * 2;
export function drawCelebration(
  c: CanvasRenderingContext2D,
  t: number,
  blue: boolean,
) {
  const color = blue ? "#61c5ff" : "#ffb573";
  c.save();
  const wash = c.createRadialGradient(660, 400, 10, 660, 400, 650);
  wash.addColorStop(0, blue ? "#228ae73b" : "#ef81283b");
  wash.addColorStop(1, "#07182700");
  c.fillStyle = wash;
  c.fillRect(0, 0, 1320, 800);
  c.translate(660, 400);
  for (let i = 0; i < 16; i++) {
    c.save();
    c.rotate((i * TAU) / 16 + t / 9000);
    c.fillStyle = i % 2 ? `${color}0c` : "#ffffff08";
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(900, -65);
    c.lineTo(900, 65);
    c.fill();
    c.restore();
  }
  c.restore();
  for (let i = 0; i < 120; i++) {
    const x = (i * 137 + Math.sin(t / 850 + i) * 30) % 1320,
      y = (t / 5 + i * 67) % 850;
    c.save();
    c.translate(x, y);
    c.rotate(t / 400 + i);
    c.fillStyle = [color, "#dfff9b", "#f9efcf", "#fff"][i % 4];
    c.fillRect(-3, -5, 5 + (i % 4), 9);
    c.restore();
  }
}
