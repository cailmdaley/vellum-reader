import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as d3Force from 'd3-force';
import * as d3Selection from 'd3-selection';
import * as d3Zoom from 'd3-zoom';
import { useMode } from '~/contexts/ModeContext';
import type { GraphLink, GraphNode } from '~/utils/content-types';

const COLORS = {
  bg: '#E8DDD0',
  text: '#2E2A26',
  muted: '#7A7368',
  gold: '#9A7B35',
  teal: '#5A7B7B',
  mauve: '#A87070',
  taupe: '#7A7368',
};

interface StatusStyle {
  fill: string;
  stroke: string;
}

const SETTLED: StatusStyle = { fill: '#2E5252', stroke: COLORS.teal };
const STATUS_STYLE: Record<string, StatusStyle> = {
  resolved: SETTLED,
  closed: SETTLED,
  active: SETTLED,
  open: { fill: '#6B5B4B', stroke: COLORS.taupe },
  unresolved: { fill: '#6B5B2E', stroke: '#B8963E' },
  blocked: { fill: '#6B3838', stroke: COLORS.mauve },
};

function statusStyle(status: string): StatusStyle {
  return STATUS_STYLE[status] ?? STATUS_STYLE.open;
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash &= hash;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value / 0x7fffffff;
  };
}

function noise2D(x: number, y: number, seed: number): number {
  const s = seed * 1000;
  return (
    Math.sin(x * 1.7 + y * 2.3 + s) * 0.4
    + Math.sin(x * 3.1 - y * 1.1 + s * 1.3) * 0.35
    + Math.sin(x * 0.9 + y * 4.1 + s * 0.7) * 0.25
  );
}

function organicEllipse(rx: number, ry: number, seed: number, scale = 1): string {
  const points = 48;
  const resolution = 0.08;
  const amplitude = 0.07;
  const coords: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * Math.PI * 2;
    const baseX = rx * scale * Math.cos(theta);
    const baseY = ry * scale * Math.sin(theta);
    const noise = noise2D(baseX * resolution, baseY * resolution, seed);
    coords.push({
      x: baseX * (1 + noise * amplitude),
      y: baseY * (1 + noise * amplitude),
    });
  }

  let path = `M${coords[0].x},${coords[0].y}`;
  for (let i = 1; i < points; i++) path += ` L${coords[i].x},${coords[i].y}`;
  return `${path} Z`;
}

function ellipsePoint(cx: number, cy: number, rx: number, ry: number, theta: number) {
  return { x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) };
}

function shortName(title: string): string {
  return title.replace(/^Decision:\s*/i, '').replace(/^Finding:\s*/i, '');
}

function wrapLabel(text: string, maxChars: number): { lines: string[]; fontSize: number } {
  const name = shortName(text);
  const baseFontSize = 9;
  const truncated = name.length > maxChars ? `${name.slice(0, maxChars - 1)}…` : name;
  const words = truncated.split(/\s+/);
  if (truncated.length <= maxChars * 0.55) return { lines: [truncated], fontSize: baseFontSize };

  const midpoint = Math.ceil(words.length / 2);
  const line1 = words.slice(0, midpoint).join(' ');
  const line2 = words.slice(midpoint).join(' ');
  const longest = Math.max(line1.length, line2.length);
  const maxLineChars = maxChars * 0.6;
  const fontSize = longest > maxLineChars ? Math.max(6, (baseFontSize * maxLineChars) / longest) : baseFontSize;
  return { lines: [line1, line2], fontSize };
}

const RING_SCALES = [1.0, 1.12];
const RING_COUNT = RING_SCALES.length;
const FILL_OPACITIES = [0.55, 0.15];
const NODE_RX = 36;
const NODE_RY = 15;

function ringOpacity(index: number): number {
  return 0.9 * (1 - index / (RING_SCALES.length * 3));
}

interface SimNode extends d3Force.SimulationNodeDatum {
  data: GraphNode;
}

interface SimLink extends d3Force.SimulationLinkDatum<SimNode> {
  kind: string;
}

function computeDistances(nodes: GraphNode[], links: GraphLink[], originId: string | undefined): Map<string, number> {
  const distances = new Map<string, number>();
  if (!originId) return distances;

  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) adjacency.set(node.id, new Set());
  for (const link of links) {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  }

  const queue: string[] = [originId];
  distances.set(originId, 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const distance = distances.get(id)!;
    for (const neighbor of adjacency.get(id) ?? []) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, distance + 1);
        queue.push(neighbor);
      }
    }
  }

  return distances;
}

function fogOpacity(distance: number | undefined, maxDist: number): number {
  if (distance === undefined) return 0.08;
  if (distance === 0) return 1.0;
  const t = Math.min(distance / Math.max(maxDist, 1), 1);
  return Math.max(0.12, 1 - t * 0.88);
}

interface MapViewProps {
  nodes: GraphNode[];
  links: GraphLink[];
  currentSlug?: string;
  changedIds?: Set<string>;
}

export function MapView({ nodes, links, currentSlug, changedIds }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { setMode } = useMode();

  const handleNodeClick = useCallback((slug: string) => {
    setMode('narrative');
    navigate(`/${slug}`);
  }, [navigate, setMode]);

  useEffect(() => {
    if (!containerRef.current || nodes.length === 0) return;
    return renderMap(containerRef.current, tooltipRef.current, nodes, links, currentSlug, handleNodeClick, changedIds);
  }, [nodes, links, currentSlug, changedIds, handleNodeClick]);

  return (
    <div className="vellum-map">
      <div ref={containerRef} className="vellum-map__canvas" />
      <div ref={tooltipRef} className="vellum-map__tooltip" />
    </div>
  );
}

function renderMap(
  container: HTMLElement,
  tooltip: HTMLDivElement | null,
  nodes: GraphNode[],
  links: GraphLink[],
  currentSlug: string | undefined,
  onNodeClick: (slug: string) => void,
  changedIds?: Set<string>,
): () => void {
  container.innerHTML = '';
  const rect = container.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 600;
  const dataFlowLinks = links.filter((link) => link.kind === 'data-flow');

  const simNodes: SimNode[] = nodes.map((node) => {
    const rand = seededRandom(hashString(node.id));
    return {
      data: node,
      x: width / 2 + (rand() - 0.5) * width * 0.8,
      y: height / 2 + (rand() - 0.5) * height * 0.8,
    };
  });
  const nodeById = new Map(simNodes.map((node) => [node.data.id, node]));

  const simLinks: SimLink[] = [];
  for (const link of dataFlowLinks) {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (source && target) simLinks.push({ source, target, kind: link.kind });
  }

  const simulation = d3Force.forceSimulation(simNodes)
    .force('link', d3Force.forceLink<SimNode, SimLink>(simLinks).distance(120).strength(0.5))
    .force('charge', d3Force.forceManyBody().strength(-200).distanceMax(500).theta(0.9))
    .force('collide', d3Force.forceCollide<SimNode>().radius(NODE_RX * 0.8).strength(0.7))
    .force('x', d3Force.forceX(width / 2).strength(0.03))
    .force('y', d3Force.forceY(height / 2).strength(0.03))
    .alphaDecay(0.015)
    .velocityDecay(0.7)
    .stop();

  for (let i = 0; i < 400; i++) simulation.tick();
  for (const node of simNodes) {
    node.fx = node.x;
    node.fy = node.y;
  }

  const currentId = currentSlug ? nodes.find((node) => node.slug === currentSlug)?.id : undefined;
  const distances = computeDistances(nodes, links, currentId);
  const maxDist = Math.min(Math.max(...Array.from(distances.values(), (value) => value), 0), 8);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of simNodes) {
    if (node.x! < minX) minX = node.x!;
    if (node.y! < minY) minY = node.y!;
    if (node.x! > maxX) maxX = node.x!;
    if (node.y! > maxY) maxY = node.y!;
  }

  const pad = NODE_RX * 3;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  const svg = d3Selection.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`)
    .style('font-family', "'EB Garamond', Georgia, serif")
    .style('cursor', 'grab');

  const rootGroup = svg.append('g');
  const zoom = d3Zoom.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.15, 5])
    .on('zoom', (event) => {
      rootGroup.attr('transform', event.transform);
      svg.style('cursor', event.sourceEvent?.type === 'mousemove' ? 'grabbing' : 'grab');
    });

  svg.call(zoom as never);

  const currentNode = currentSlug ? simNodes.find((node) => node.data.slug === currentSlug) : null;
  if (currentNode && currentNode.x != null && currentNode.y != null) {
    const scale = 2;
    const centerX = vbX + vbW / 2;
    const centerY = vbY + vbH / 2;
    const tx = centerX - currentNode.x * scale;
    const ty = centerY - currentNode.y * scale;
    svg.call(zoom.transform as never, d3Zoom.zoomIdentity.translate(tx, ty).scale(scale));
  }

  const edgeGroup = rootGroup.append('g').attr('class', 'map-edges');
  for (const link of dataFlowLinks) {
    const sourceNode = nodeById.get(link.source);
    const targetNode = nodeById.get(link.target);
    if (!sourceNode || !targetNode || sourceNode.x == null || targetNode.x == null) continue;

    const edgeFog = Math.min(fogOpacity(distances.get(link.source), maxDist), fogOpacity(distances.get(link.target), maxDist));
    const sx = sourceNode.x;
    const sy = sourceNode.y!;
    const tx = targetNode.x;
    const ty = targetNode.y!;
    const edgeHash = hashString(link.source + link.target);
    const edgeRand = seededRandom(edgeHash / 1000000);
    const baseAngle = Math.atan2(ty - sy, tx - sx);
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const tangentX = dist > 0 ? dx / dist : 1;
    const tangentY = dist > 0 ? dy / dist : 0;
    const perpX = -tangentY;
    const perpY = tangentX;

    for (let ring = 0; ring < RING_COUNT; ring++) {
      const ringScale = RING_SCALES[ring];
      const spreadRange = Math.PI * 0.1;
      const angleOffset = (ring - 0.5) * spreadRange;
      const start = ellipsePoint(sx, sy, NODE_RX * ringScale, NODE_RY * ringScale, baseAngle + angleOffset);
      const end = ellipsePoint(tx, ty, NODE_RX * ringScale, NODE_RY * ringScale, baseAngle + Math.PI + angleOffset);
      const edgeDistance = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
      const sagSign = Math.sin(baseAngle * 2 + edgeRand() * Math.PI * 2) >= 0 ? 1 : -1;
      const sagAmount = edgeDistance * (edgeRand() * 0.1 + 0.03) * sagSign;
      const wobble1 = (edgeRand() - 0.5) * 6;
      const wobble2 = (edgeRand() - 0.5) * 6;
      const tension = 0.35 + edgeRand() * 0.1;

      const cp1x = start.x + tangentX * edgeDistance * tension + perpX * (sagAmount + wobble1);
      const cp1y = start.y + tangentY * edgeDistance * tension + perpY * (sagAmount + wobble1);
      const cp2x = end.x - tangentX * edgeDistance * tension + perpX * (sagAmount + wobble2);
      const cp2y = end.y - tangentY * edgeDistance * tension + perpY * (sagAmount + wobble2);

      edgeGroup.append('path')
        .attr('d', `M${start.x},${start.y} C${cp1x},${cp1y} ${cp2x},${cp2y} ${end.x},${end.y}`)
        .attr('fill', 'none')
        .attr('stroke', COLORS.gold)
        .attr('stroke-width', ring === 0 ? 0.8 : 0.4)
        .attr('stroke-opacity', ringOpacity(ring) * 0.4 * edgeFog)
        .attr('stroke-linecap', 'round');
    }
  }

  const knockoutGroup = rootGroup.append('g').attr('class', 'map-knockouts');
  const nodeGroup = rootGroup.append('g').attr('class', 'map-nodes');
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  for (const simNode of simNodes) {
    const { data: node } = simNode;
    const x = simNode.x!;
    const y = simNode.y!;
    const isCurrent = node.slug === currentSlug;
    const isChanged = changedIds?.has(node.slug) ?? false;
    const nodeSeed = hashString(node.id) / 1000000;
    const nodeFog = fogOpacity(distances.get(node.id), maxDist);
    const { fill, stroke } = statusStyle(node.status);

    const group = nodeGroup.append('g')
      .attr('class', 'map-node')
      .attr('data-slug', node.slug ?? '')
      .attr('transform', `translate(${x}, ${y})`)
      .style('cursor', 'pointer')
      .style('opacity', isCurrent ? 1 : nodeFog);

    group.on('click', () => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (tooltip) tooltip.style.display = 'none';
      onNodeClick(node.slug);
    });

    group.on('mouseenter', (event: MouseEvent) => {
      if (!tooltip) return;
      const cx = event.clientX;
      const cy = event.clientY;
      hoverTimer = setTimeout(() => {
        const statusLabel = node.status.charAt(0).toUpperCase() + node.status.slice(1);
        const parts: string[] = [];
        if (node.decisionCount) parts.push(`${node.decisionCount}d`);
        if (node.findingCount) parts.push(`${node.findingCount}f`);
        const counts = parts.length > 0
          ? `<span style="color:${COLORS.muted};font-size:11px;margin-left:6px">${parts.join(' ')}</span>`
          : '';
        const verdictHtml = node.verdict
          ? `<div style="font-size:12px;font-style:italic;margin-top:4px;line-height:1.4;color:${COLORS.text}">${node.verdict.slice(0, 200)}${node.verdict.length > 200 ? '…' : ''}</div>`
          : '';
        tooltip.innerHTML = `
          <div style="font-weight:600;margin-bottom:2px">${node.label}</div>
          <div><span style="color:${stroke};font-size:11px">${statusLabel}</span>${counts}</div>
          ${verdictHtml}
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = `${cx + 14}px`;
        tooltip.style.top = `${cy - 8}px`;
      }, 200);
    });

    group.on('mousemove', (event: MouseEvent) => {
      if (!tooltip || tooltip.style.display === 'none') return;
      tooltip.style.left = `${event.clientX + 14}px`;
      tooltip.style.top = `${event.clientY - 8}px`;
    });

    group.on('mouseleave', () => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (tooltip) tooltip.style.display = 'none';
    });

    knockoutGroup.append('path')
      .attr('transform', `translate(${x}, ${y})`)
      .attr('d', organicEllipse(NODE_RX, NODE_RY, nodeSeed, 1.0))
      .attr('fill', COLORS.bg)
      .attr('fill-opacity', isCurrent ? 1.0 : nodeFog)
      .attr('stroke', 'none');

    for (let ring = RING_COUNT - 1; ring >= 0; ring--) {
      group.append('path')
        .attr('d', organicEllipse(NODE_RX, NODE_RY, nodeSeed + ring * 0.1, RING_SCALES[ring]))
        .attr('fill', fill)
        .attr('fill-opacity', FILL_OPACITIES[ring])
        .attr('stroke', 'none');
    }

    for (let ring = 0; ring < RING_COUNT; ring++) {
      group.append('path')
        .attr('d', organicEllipse(NODE_RX, NODE_RY, nodeSeed + ring * 0.1, RING_SCALES[ring]))
        .attr('fill', 'none')
        .attr('stroke', stroke)
        .attr('stroke-opacity', ringOpacity(ring))
        .attr('stroke-width', isCurrent && ring === 0 ? 1.9 : 1.1);
    }

    if (isChanged) {
      group.append('path')
        .attr('d', organicEllipse(NODE_RX + 6, NODE_RY + 4, nodeSeed + 0.5, 1))
        .attr('fill', 'none')
        .attr('stroke', COLORS.gold)
        .attr('stroke-width', 1.1)
        .attr('stroke-dasharray', '3 3')
        .attr('stroke-opacity', 0.85);
    }

    const label = wrapLabel(node.label, 20);
    label.lines.forEach((line, index) => {
      group.append('text')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('y', (index - (label.lines.length - 1) / 2) * (label.fontSize + 1))
        .attr('fill', '#f3ede6')
        .attr('font-size', label.fontSize)
        .attr('font-weight', isCurrent ? 600 : 500)
        .text(line);
    });
  }

  return () => {
    if (hoverTimer) clearTimeout(hoverTimer);
    simulation.stop();
    container.innerHTML = '';
  };
}
