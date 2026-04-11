/**
 * MapView — D3 force-directed DAG with organic, cartographic rendering.
 *
 * Full-column map that shows the project's fiber graph as a spatial overview.
 * Click a node to navigate to that fiber in Narrative mode.
 * Zoom/pan with mouse wheel + drag.
 *
 * Rendering: noise-deformed ellipses with concentric rings, multi-strand
 * cubic Bezier edges — the Weathered Substrate aesthetic from portolan.
 */

import { useRef, useEffect, useCallback } from 'react';
import { useNavigate } from '@remix-run/react';
import { useMode } from '~/contexts/ModeContext';
import * as d3Selection from 'd3-selection';
import * as d3Zoom from 'd3-zoom';
import * as d3Force from 'd3-force';
import type { GraphNode, GraphLink } from '~/utils/content-types';

// ── Palette (Weathered Substrate) ──

const COLORS = {
  bg: '#E8DDD0',
  text: '#2E2A26',
  muted: '#7A7368',
  gold: '#9A7B35',
  teal: '#5A7B7B',
  mauve: '#A87070',
  taupe: '#7A7368',
};

const STATUS_STROKE: Record<string, string> = {
  resolved: COLORS.teal,
  closed: COLORS.teal,
  open: COLORS.taupe,
  active: COLORS.teal,
  suspicious: '#B8963E',
  blocked: COLORS.mauve,
};

const STATUS_FILL: Record<string, string> = {
  resolved: '#2E5252',
  closed: '#2E5252',
  open: '#6B5B4B',
  active: '#2E5252',
  suspicious: '#6B5B2E',
  blocked: '#6B3838',
};

// ── Procedural geometry ──

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function noise2D(x: number, y: number, seed: number): number {
  const s = seed * 1000;
  return (
    Math.sin(x * 1.7 + y * 2.3 + s) * 0.4 +
    Math.sin(x * 3.1 - y * 1.1 + s * 1.3) * 0.35 +
    Math.sin(x * 0.9 + y * 4.1 + s * 0.7) * 0.25
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
    const n = noise2D(baseX * resolution, baseY * resolution, seed);
    coords.push({
      x: baseX * (1 + n * amplitude),
      y: baseY * (1 + n * amplitude),
    });
  }
  let d = `M${coords[0].x},${coords[0].y}`;
  for (let i = 1; i < points; i++) d += ` L${coords[i].x},${coords[i].y}`;
  return d + ' Z';
}

function ellipsePoint(
  cx: number, cy: number, rx: number, ry: number, theta: number,
): { x: number; y: number } {
  return { x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) };
}

// ── Label helpers ──

function shortName(title: string): string {
  return title.replace(/^Decision:\s*/i, '').replace(/^Finding:\s*/i, '');
}

function wrapLabel(
  text: string,
  maxChars: number,
): { lines: string[]; fontSize: number } {
  const name = shortName(text);
  const baseFontSize = 9;
  const truncated = name.length > maxChars
    ? name.slice(0, maxChars - 1) + '\u2026'
    : name;
  const words = truncated.split(/\s+/);
  if (truncated.length <= maxChars * 0.55) {
    return { lines: [truncated], fontSize: baseFontSize };
  }
  const midpoint = Math.ceil(words.length / 2);
  const line1 = words.slice(0, midpoint).join(' ');
  const line2 = words.slice(midpoint).join(' ');
  const longest = Math.max(line1.length, line2.length);
  const maxLineChars = maxChars * 0.6;
  const fontSize = longest > maxLineChars
    ? Math.max(6, baseFontSize * maxLineChars / longest)
    : baseFontSize;
  return { lines: [line1, line2], fontSize };
}

// ── Ring constants ──

const RING_SCALES = [1.0, 1.12];
const RING_COUNT = RING_SCALES.length;
const FILL_OPACITIES = [0.55, 0.15];

function ringOpacity(index: number): number {
  return 0.9 * (1 - index / (RING_SCALES.length * 3));
}

// ── Node sizing ──

const NODE_RX = 36;
const NODE_RY = 15;

// ── Simulation types ──

interface SimNode extends d3Force.SimulationNodeDatum {
  data: GraphNode;
}

interface SimLink extends d3Force.SimulationLinkDatum<SimNode> {
  kind: string;
}

// ── Graph distance (BFS) for fog-of-war ──

function computeDistances(
  nodes: GraphNode[],
  links: GraphLink[],
  originId: string | undefined,
): Map<string, number> {
  const distances = new Map<string, number>();
  if (!originId) return distances;

  // Build adjacency list from ALL link kinds (containment + data-flow)
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const link of links) {
    adj.get(link.source)?.add(link.target);
    adj.get(link.target)?.add(link.source);
  }

  // BFS from origin
  const queue: string[] = [originId];
  distances.set(originId, 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = distances.get(id)!;
    for (const neighbor of adj.get(id) ?? []) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, d + 1);
        queue.push(neighbor);
      }
    }
  }
  return distances;
}

/** Map graph distance to visual opacity. Close = bright, far = dim. */
function fogOpacity(distance: number | undefined, maxDist: number): number {
  if (distance === undefined) return 0.08; // unreachable nodes are nearly invisible
  if (distance === 0) return 1.0;
  // Smooth falloff: 1.0 at d=0, ~0.12 at large distances
  const t = Math.min(distance / Math.max(maxDist, 1), 1);
  return Math.max(0.12, 1 - t * 0.88);
}

// ── Component ──

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
    return renderMap(
      containerRef.current,
      tooltipRef.current,
      nodes,
      links,
      currentSlug,
      handleNodeClick,
      changedIds,
    );
  }, [nodes, links, currentSlug, changedIds, handleNodeClick]);

  return (
    <div className="vellum-map">
      <div ref={containerRef} className="vellum-map__canvas" />
      <div ref={tooltipRef} className="vellum-map__tooltip" />
    </div>
  );
}

// ── Rendering ──

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

  // ── Force simulation ──
  // Only use data-flow links for layout forces
  const dataFlowLinks = links.filter((l) => l.kind === 'data-flow');

  // Seed initial positions from node ID hash for deterministic layout
  const simNodes: SimNode[] = nodes.map((n) => {
    const rand = seededRandom(hashString(n.id));
    return {
      data: n,
      x: width / 2 + (rand() - 0.5) * width * 0.8,
      y: height / 2 + (rand() - 0.5) * height * 0.8,
    };
  });
  const nodeById = new Map(simNodes.map((sn) => [sn.data.id, sn]));

  const simLinks: SimLink[] = [];
  for (const link of dataFlowLinks) {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (source && target) {
      simLinks.push({ source, target, kind: link.kind });
    }
  }

  const simulation = d3Force.forceSimulation(simNodes)
    .force('link', d3Force.forceLink<SimNode, SimLink>(simLinks)
      .distance(120)
      .strength(0.5))
    .force('charge', d3Force.forceManyBody()
      .strength(-200)
      .distanceMax(500)
      .theta(0.9))
    .force('collide', d3Force.forceCollide<SimNode>()
      .radius(NODE_RX * 0.8)
      .strength(0.7))
    .force('x', d3Force.forceX(width / 2).strength(0.03))
    .force('y', d3Force.forceY(height / 2).strength(0.03))
    .alphaDecay(0.015)
    .velocityDecay(0.7)
    .stop();

  // Warm up
  for (let i = 0; i < 400; i++) simulation.tick();

  // Pin positions
  for (const sn of simNodes) {
    sn.fx = sn.x;
    sn.fy = sn.y;
  }

  // ── Fog-of-war: compute graph distances from current node ──
  const currentId = currentSlug
    ? nodes.find((n) => n.slug === currentSlug)?.id
    : undefined;
  const distances = computeDistances(nodes, links, currentId);
  // Use a capped max distance so falloff isn't too extreme on large graphs
  const maxDist = Math.min(
    Math.max(...Array.from(distances.values())),
    8, // cap: beyond 8 hops, everything is equally dim
  );

  // ── Compute viewBox from positioned nodes ──
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const sn of simNodes) {
    if (sn.x! < minX) minX = sn.x!;
    if (sn.y! < minY) minY = sn.y!;
    if (sn.x! > maxX) maxX = sn.x!;
    if (sn.y! > maxY) maxY = sn.y!;
  }
  const pad = NODE_RX * 3;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = (maxX - minX) + pad * 2;
  const vbH = (maxY - minY) + pad * 2;

  // ── SVG ──
  const svg = d3Selection
    .select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`)
    .style('font-family', "'EB Garamond', Georgia, serif")
    .style('cursor', 'grab');

  const rootGroup = svg.append('g');

  // Zoom
  const zoom = d3Zoom
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.15, 5])
    .on('zoom', (event) => {
      rootGroup.attr('transform', event.transform);
      svg.style('cursor', event.sourceEvent?.type === 'mousemove' ? 'grabbing' : 'grab');
    });
  svg.call(zoom as any);

  // Center on current node if available (viewBox coordinate space)
  const currentNode = currentSlug
    ? simNodes.find((sn) => sn.data.slug === currentSlug)
    : null;
  if (currentNode && currentNode.x != null && currentNode.y != null) {
    const scale = 2;
    const centerX = vbX + vbW / 2;
    const centerY = vbY + vbH / 2;
    const tx = centerX - currentNode.x * scale;
    const ty = centerY - currentNode.y * scale;
    svg.call(
      zoom.transform as any,
      d3Zoom.zoomIdentity.translate(tx, ty).scale(scale),
    );
  }

  // ── Edges ──
  const edgeGroup = rootGroup.append('g').attr('class', 'map-edges');

  for (const link of dataFlowLinks) {
    const sNode = nodeById.get(link.source);
    const tNode = nodeById.get(link.target);
    if (!sNode || !tNode || sNode.x == null || tNode.x == null) continue;

    // Fog-of-war: edge opacity is the minimum of its two endpoints
    const edgeFog = Math.min(
      fogOpacity(distances.get(link.source), maxDist),
      fogOpacity(distances.get(link.target), maxDist),
    );

    const sx = sNode.x, sy = sNode.y!;
    const tx = tNode.x, ty = tNode.y!;
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

    for (let s = 0; s < RING_COUNT; s++) {
      const ringScale = RING_SCALES[s];
      const spreadRange = Math.PI * 0.1;
      const angleOffset = (s - 0.5) * spreadRange;

      const start = ellipsePoint(sx, sy, NODE_RX * ringScale, NODE_RY * ringScale, baseAngle + angleOffset);
      const end = ellipsePoint(tx, ty, NODE_RX * ringScale, NODE_RY * ringScale, baseAngle + Math.PI + angleOffset);

      const eDist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
      const sagSign = Math.sin(baseAngle * 2 + edgeRand() * Math.PI * 2) >= 0 ? 1 : -1;
      const sagAmount = eDist * (edgeRand() * 0.1 + 0.03) * sagSign;
      const wobble1 = (edgeRand() - 0.5) * 6;
      const wobble2 = (edgeRand() - 0.5) * 6;
      const tension = 0.35 + edgeRand() * 0.1;

      const cp1x = start.x + tangentX * eDist * tension + perpX * (sagAmount + wobble1);
      const cp1y = start.y + tangentY * eDist * tension + perpY * (sagAmount + wobble1);
      const cp2x = end.x - tangentX * eDist * tension + perpX * (sagAmount + wobble2);
      const cp2y = end.y - tangentY * eDist * tension + perpY * (sagAmount + wobble2);

      edgeGroup
        .append('path')
        .attr('d', `M${start.x},${start.y} C${cp1x},${cp1y} ${cp2x},${cp2y} ${end.x},${end.y}`)
        .attr('fill', 'none')
        .attr('stroke', COLORS.gold)
        .attr('stroke-width', s === 0 ? 0.8 : 0.4)
        .attr('stroke-opacity', ringOpacity(s) * 0.4 * edgeFog)
        .attr('stroke-linecap', 'round');
    }
  }

  // ── Nodes ──
  const knockoutGroup = rootGroup.append('g').attr('class', 'map-knockouts');
  const nodeGroup = rootGroup.append('g').attr('class', 'map-nodes');
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  for (const sn of simNodes) {
    const { data: node } = sn;
    const x = sn.x!, y = sn.y!;
    const isCurrent = node.slug === currentSlug;
    const isChanged = changedIds?.has(node.slug) ?? false;
    const nodeHash = hashString(node.id);
    const nodeSeed = nodeHash / 1000000;
    const nodeFog = fogOpacity(distances.get(node.id), maxDist);

    const fillColor = STATUS_FILL[node.status] ?? STATUS_FILL.open;
    const strokeColor = STATUS_STROKE[node.status] ?? STATUS_STROKE.open;

    const g = nodeGroup
      .append('g')
      .attr('class', 'map-node')
      .attr('data-slug', node.slug ?? '')
      .attr('transform', `translate(${x}, ${y})`)
      .style('cursor', 'pointer')
      .style('opacity', isCurrent ? 1 : nodeFog);

    // Click → navigate
    g.on('click', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (tooltip) tooltip.style.display = 'none';
      onNodeClick(node.slug);
    });

    // Hover → tooltip
    g.on('mouseenter', (event: MouseEvent) => {
      if (!tooltip) return;
      const cx = event.clientX;
      const cy = event.clientY;
      hoverTimer = setTimeout(() => {
        if (!tooltip) return;
        const statusLabel = node.status.charAt(0).toUpperCase() + node.status.slice(1);
        const parts: string[] = [];
        if (node.decisionCount) parts.push(`${node.decisionCount}d`);
        if (node.findingCount) parts.push(`${node.findingCount}f`);
        const counts = parts.length > 0
          ? `<span style="color:${COLORS.muted};font-size:11px;margin-left:6px">${parts.join(' ')}</span>`
          : '';
        const verdictHtml = node.verdict
          ? `<div style="font-size:12px;font-style:italic;margin-top:4px;line-height:1.4;color:${COLORS.text}">${node.verdict.slice(0, 200)}${node.verdict.length > 200 ? '\u2026' : ''}</div>`
          : '';
        tooltip.innerHTML = `
          <div style="font-weight:600;margin-bottom:2px">${node.label}</div>
          <div><span style="color:${strokeColor};font-size:11px">${statusLabel}</span>${counts}</div>
          ${verdictHtml}
        `;
        tooltip.style.display = 'block';
        tooltip.style.left = `${cx + 14}px`;
        tooltip.style.top = `${cy - 8}px`;
      }, 200);
    });

    g.on('mousemove', (event: MouseEvent) => {
      if (!tooltip || tooltip.style.display === 'none') return;
      tooltip.style.left = `${event.clientX + 14}px`;
      tooltip.style.top = `${event.clientY - 8}px`;
    });

    g.on('mouseleave', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (tooltip) tooltip.style.display = 'none';
    });

    // Knockout (clears edges behind node)
    knockoutGroup
      .append('path')
      .attr('transform', `translate(${x}, ${y})`)
      .attr('d', organicEllipse(NODE_RX, NODE_RY, nodeSeed, 1.0))
      .attr('fill', COLORS.bg)
      .attr('fill-opacity', isCurrent ? 1.0 : nodeFog)
      .attr('stroke', 'none');

    // Ring fills
    for (let ring = RING_COUNT - 1; ring >= 0; ring--) {
      const scale = RING_SCALES[ring];
      g.append('path')
        .attr('d', organicEllipse(NODE_RX, NODE_RY, nodeSeed + ring * 0.1, scale))
        .attr('fill', fillColor)
        .attr('fill-opacity', FILL_OPACITIES[ring])
        .attr('stroke', 'none');
    }

    // Ring strokes
    for (let ring = 0; ring < RING_COUNT; ring++) {
      const scale = RING_SCALES[ring];
      const isCore = ring === 0;
      g.append('path')
        .attr('d', organicEllipse(NODE_RX, NODE_RY, nodeSeed + ring * 0.1, scale))
        .attr('fill', 'none')
        .attr('stroke', isCurrent ? COLORS.gold : strokeColor)
        .attr('stroke-width', isCurrent ? 1.8 : (isCore ? 0.7 : 0.4))
        .attr('stroke-opacity', ringOpacity(ring) * (isCore ? 0.85 : 1));
    }

    // Gold glow for current fiber
    if (isCurrent) {
      g.append('path')
        .attr('d', organicEllipse(NODE_RX, NODE_RY, nodeSeed, 1.25))
        .attr('fill', 'none')
        .attr('stroke', COLORS.gold)
        .attr('stroke-width', 1.2)
        .attr('stroke-opacity', 0.3);
    }

    // Gold ring for changed-since-last-visit fibers
    if (isChanged && !isCurrent) {
      g.append('path')
        .attr('d', organicEllipse(NODE_RX, NODE_RY, nodeSeed, 1.2))
        .attr('fill', 'none')
        .attr('stroke', COLORS.gold)
        .attr('stroke-width', 0.8)
        .attr('stroke-opacity', 0.5)
        .attr('stroke-dasharray', '3,2');
    }

    // Label
    const { lines, fontSize } = wrapLabel(node.label, 20);
    const lineHeight = fontSize * 1.15;

    if (lines.length === 1) {
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('y', fontSize * 0.35)
        .attr('font-size', `${fontSize}px`)
        .attr('fill', COLORS.text)
        .attr('fill-opacity', 0.85)
        .text(lines[0]);
    } else {
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('y', -lineHeight * 0.5 + fontSize * 0.35)
        .attr('font-size', `${fontSize}px`)
        .attr('fill', COLORS.text)
        .attr('fill-opacity', 0.85)
        .text(lines[0]);
      g.append('text')
        .attr('text-anchor', 'middle')
        .attr('y', lineHeight * 0.5 + fontSize * 0.35)
        .attr('font-size', `${fontSize}px`)
        .attr('fill', COLORS.text)
        .attr('fill-opacity', 0.85)
        .text(lines[1]);
    }
  }

  return () => {
    simulation.stop();
    if (hoverTimer) clearTimeout(hoverTimer);
    if (tooltip) tooltip.style.display = 'none';
    container.innerHTML = '';
  };
}
