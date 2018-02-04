import React from 'react';
import moment from 'moment';
import styled from 'styled-components';
import {
  debounce,
  min,
  max,
  flatten,
  sortedIndex,
  range,
  values,
  sortBy,
  first,
  last,
  minBy,
  find,
  flatMap,
} from 'lodash';
import { scaleLinear, scaleQuantize } from 'd3-scale';
import { line, stack, area } from 'd3-shape';

import AxesGrid from './_AxesGrid';
import DeploymentAnnotations from './_DeploymentAnnotations';
import HoverInfo from './_HoverInfo';
import GraphLegend from './_GraphLegend';

function parseGraphValue(value) {
  const val = parseFloat(value);
  if (Number.isNaN(val)) {
    // "+Inf", "-Inf", "+Inf" will be parsed into NaN by parseFloat(). The
    // can't be graphed, so show them as gaps (null).
    return null;
  }
  return val;
}

function getDatapointAtTimestamp(series, timestampSec) {
  const timestamps = series.datapoints.map(d => d.timestampSec);
  const index = sortedIndex(timestamps, timestampSec);
  return series.datapoints[index];
}

const GraphContainer = styled.div`
  position: relative;
`;

const Graph = styled.div`
  position: relative;
  min-height: 170px;
  margin-bottom: 20px;
`;

const Canvas = styled.svg`
  cursor: crosshair;
  position: absolute;
`;

const AxisLabel = styled.span`
  color: ${props => props.theme.colors.neutral.black};
  font-size: ${props => props.theme.fontSizes.normal};
  transform: translate(-60px, 165px) rotate(-90deg);
  transform-origin: left top 0;
  display: inline-block;
`;

const SeriesLineChart = styled.path.attrs({
  strokeWidth: 2,
  fill: 'none',
})`
  opacity: ${props => (props.faded ? 0.1 : 1)};
  pointer-events: none;
`;

const SeriesAreaChart = styled.path.attrs({
  // Use strokeWidth only on focused area graphs to make sure ultra-thin ones
  // still get visible, but don't use it when multiple series are visible so
  // that it doesn't look like it's other series' border.
  strokeWidth: ({ focused }) => (focused ? 1 : 0),
  stroke: ({ fill }) => fill,
})`
  opacity: ${props => (props.faded ? 0.05 : 0.75)};
  pointer-events: none;
`;

const colorSchemes = {
  mixed: (index) => {
    const colors = [
      'hsl(209, 44%, 83%)',
      'hsl(98, 55%, 81%)',
      'hsl(210, 45%, 74%)',
      'hsl(166, 44%, 65%)',
      'hsl(230, 34%, 66%)',
      'hsl(196, 84%, 52%)', // Weaveworks 'blue accent' color, not interpolated because it looked too dark
      'hsl(240, 20%, 59%)', // Weaveworks 'lavender' color
      'hsl(197, 74%, 43%)',
      'hsl(261, 39%, 44%)',
      'hsl(213, 66%, 40%)',
      'hsl(261, 68%, 29%)',
      'hsl(232, 60%, 36%)',
      'hsl(248, 82%, 11%)', // Weaveworks 'charcoal' color interpolated for 75% opacity
      'hsl(212, 88%, 27%)',
    ];

    return colors[index % colors.length];
  },

  blue: (index) => {
    // http://colorbrewer2.org/#type=sequential&scheme=YlGnBu&n=9 from d3 without 2 lightest colours
    const colors = [
      'hsl(98, 55%, 81%)',
      'hsl(166, 44%, 65%)',
      'hsl(196, 84%, 52%)', // Weaveworks 'blue accent' color, not interpolated because it looked too dark
      'hsl(197, 74%, 43%)',
      'hsl(213, 66%, 40%)',
      'hsl(232, 60%, 36%)',
      'hsl(212, 88%, 27%)',
    ];
    return colors[index % colors.length];
  },

  purple: (index) => {
    // http://colorbrewer2.org/#type=sequential&scheme=BuPu&n=9 without 2 lightest colours
    const colors = [
      'hsl(209, 44%, 83%)',
      'hsl(210, 45%, 74%)',
      'hsl(230, 34%, 66%)',
      'hsl(240, 20%, 59%)', // Weaveworks 'lavender' color
      'hsl(286, 41%, 44%)',
      'hsl(303, 79%, 28%)',
      'hsl(248, 82%, 11%)', // Weaveworks 'charcoal' color interpolated for 75% opacity
    ];
    return colors[index % colors.length];
  },
};

/* eslint-disable no-restricted-properties */
function spreadTicksBetween(start, end, { steps, formatFor, scale }) {
  // Tweak the step to show a reasonable number of ticks.
  const step = find(steps, s => (end - start) / s < 5);
  const ti = range(min, max, step);
  const format = formatFor(step);

  return ti.map(t => ({
    value: format(t),
    offset: scale(t),
  }));
}

export const units = {
  none: {
    getSteps() {
      const powersOf10 = range(-4, 15).map(p => Math.pow(10, p));
      return flatMap(powersOf10, p => [p, 2 * p, 5 * p]);
    },
    formatFor(number) {
      let baseUnit = 1;
      let precision = 4;
      let unitLabel = '';

      const bigNumber = [
        { label: 'T', unit: 1000000000000 },
        { label: 'G', unit: 1000000000 },
        { label: 'M', unit: 1000000 },
        { label: 'k', unit: 1000 },
      ].find(({ unit }) => number / unit >= 2);
      const smallNumber = [
        { base: 1, prec: 0 },
        { base: 0.1, prec: 1 },
        { base: 0.01, prec: 2 },
        { base: 0.001, prec: 3 },
        { base: 0.0001, prec: 4 },
      ].find(({ base }) => number / base >= 2);

      if (bigNumber) {
        baseUnit = bigNumber.unit;
        unitLabel = bigNumber.label;
        precision = 0;
      } else if (smallNumber) {
        precision = smallNumber.prec;
      }

      return (n) => {
        if (n === null) return '---';
        if (n === 0) return '0';
        return `${(n / baseUnit).toFixed(precision)} ${unitLabel}`;
      };
    },
    getSpread(start, end, scale) {
      return spreadTicksBetween(start, end, {
        steps: this.getSteps(),
        formatFor: this.formatFor,
        scale,
      });
    },
  },

  bytes: {
    getSteps() {
      return range(50).map(p => Math.pow(2, p));
    },
    formatFor(bytes) {
      const data = [
        { label: 'TB', unit: 1024 * 1024 * 1024 * 1024 },
        { label: 'GB', unit: 1024 * 1024 * 1024 },
        { label: 'MB', unit: 1024 * 1024 },
        { label: 'kB', unit: 1024 },
        { label: 'B', unit: 1 },
      ].find(({ unit }) => bytes / unit >= 2);

      return (n) => {
        if (n === null) return '---';
        if (!data) return '0';
        return `${Math.round(n / data.unit)} ${data.label}`;
      };
    },
    getSpread(start, end, scale) {
      return spreadTicksBetween(start, end, {
        steps: this.getSteps(),
        formatFor: this.formatFor,
        scale,
      });
    },
  },

  percent: {
    getSteps() {
      const powersOf10 = range(-6, 4).map(p => Math.pow(10, p));
      return flatMap(powersOf10, p => [p, 2 * p, 5 * p]);
    },
    formatFor() {
      return (n) => {
        if (n === null) return '---';
        if (n === 0) return '0%';
        return `${Number(n * 100).toFixed(2)}%`;
      };
    },
    getSpread(start, end, scale) {
      return spreadTicksBetween(start, end, {
        steps: this.getSteps(),
        formatFor: this.formatFor,
        scale,
      });
    },
  },

  seconds: {
    getSteps() {
      return [1, 2, 5, 15, 30, 60, 120, 300, 900, 1800, 3600, 7200, 14400, 28800];
    },
    format(seconds) {
      if (seconds === null) return '---';

      const timestamp = moment(seconds * 1000).utc();

      // Show month and day instead of hour and minute at midnight.
      const startOfDay = timestamp.clone().startOf('day');
      if (timestamp.diff(startOfDay) === 0) {
        return timestamp.format('MMM DD');
      }

      return timestamp.format('HH:mm');
    },
    getSpread(start, end, scale) {
      return spreadTicksBetween(start, end, {
        steps: this.getSteps(),
        formatFor: () => this.format,
        scale,
      });
    },
  }
};

class DashboardGraph extends React.PureComponent {
  constructor(props, context) {
    super(props, context);

    this.state = {
      selectedLegendSeriesKey: null,
      hoveredLegendSeriesKey: null,
      hoverTimestampSec: null,
      hoverYOffset: null,
      hoverXOffset: null,
      hoverPoints: null,
      multiSeries: [],
    };

    this.saveSvgRef = this.saveSvgRef.bind(this);
    this.processMultiSeries = this.processMultiSeries.bind(this);
    this.handleResize = debounce(this.handleResize.bind(this), 200);

    this.handleGraphMouseMove = this.handleGraphMouseMove.bind(this);
    this.handleGraphMouseLeave = this.handleGraphMouseLeave.bind(this);

    this.handleSelectedLegendSeriesChange = this.handleSelectedLegendSeriesChange.bind(this);
    this.handleHoveredLegendSeriesChange = this.handleHoveredLegendSeriesChange.bind(this);
  }

  handleResize() {
    this.forceUpdate();
  }

  componentWillMount() {
    this.processMultiSeries(this.props);
  }

  componentDidMount() {
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.handleResize);
  }

  componentWillReceiveProps(nextProps) {
    if (this.props.multiSeries !== nextProps.multiSeries) {
      this.processMultiSeries(nextProps);
    }
  }

  handleSelectedLegendSeriesChange(selectedLegendSeriesKey) {
    this.setState({ selectedLegendSeriesKey });
  }

  handleHoveredLegendSeriesChange(hoveredLegendSeriesKey) {
    this.setState({ hoveredLegendSeriesKey });
  }

  handleGraphMouseMove(ev) {
    const { left, top } = this.getSvgBoundingRect();
    const timestampQuantizer = this.getTimestampQuantizer();
    const valueScale = this.getValueScale();
    const timeScale = this.getTimeScale();
    const cursorXOffset = ev.clientX - left;
    const cursorYOffset = ev.clientY - top;

    const cursorValue = valueScale.invert(cursorYOffset);
    const cursorTimestampSec = timeScale.invert(cursorXOffset);
    const hoverTimestampSec = timestampQuantizer(cursorTimestampSec);

    // Build an array of hover points by evaluating the multiseries at the cursor x-coord.
    let hoverPoints = this.getVisibleMultiSeries().map((series) => {
      const datapoint = getDatapointAtTimestamp(series, hoverTimestampSec);
      const graphValue = this.getDatapointGraphValue(datapoint);
      return {
        graphValue,
        value: datapoint.value,
        key: series.key,
        name: series.name,
        color: series.color,
      };
    });

    let focusedSeries = {};
    if (this.props.showStacked) {
      // If the graph is stacked, focus the closest series above the,
      // cursor, as that one's area is hovered by the mouse cursor.
      const isSeriesAbove = s => s.graphValue >= cursorValue;
      const hoverPointsAboveCursor = hoverPoints.filter(isSeriesAbove);
      focusedSeries = minBy(hoverPointsAboveCursor, 'graphValue') || {};
    } else {
      // Otherwise, in a line graph focus the series with the nearest value.
      const distanceFromCursor = s => Math.abs(s.graphValue - cursorValue);
      focusedSeries = minBy(hoverPoints, distanceFromCursor) || {};
    }

    // Update the hover points with focus data.
    hoverPoints = hoverPoints.map(s => ({
      ...s,
      focused: focusedSeries.key === s.key,
    }));

    // Simple tooltip will only show the value for the hovered series.
    if (this.props.simpleTooltip) {
      hoverPoints = hoverPoints.filter(p => p.focused);
    }

    this.setState({
      hoverYOffset: cursorYOffset,
      hoverXOffset: timeScale(hoverTimestampSec),
      hoverTimestampSec,
      hoverPoints,
    });
  }

  handleGraphMouseLeave() {
    this.setState({
      hoverYOffset: null,
      hoverXOffset: null,
      hoverTimestampSec: null,
      hoverPoints: null,
    });
  }

  saveSvgRef(ref) {
    this.svgRef = ref;
  }

  getSvgBoundingRect() {
    return this.svgRef
      ? this.svgRef.getBoundingClientRect()
      : { width: 0, height: 0, top: 0, left: 0 };
  }

  processMultiSeries(props) {
    // Get the sorted list of names for all the series.
    const multiSeriesNames = props.multiSeries
      .map(series => props.getLabel(series))
      .sort();

    // This D3 scale takes care of rounding all the datapoints to the nearest discrete timestamp.
    const timestampQuantizer = this.getTimestampQuantizer(props);
    const timestampSecs = timestampQuantizer.range();

    // Initialize all the graph values to null, as if the graph was empty.
    const valuesByTimestamp = {};
    timestampSecs.forEach((timestampSec) => {
      valuesByTimestamp[timestampSec] = { timestampSec };
      multiSeriesNames.forEach((seriesName) => {
        valuesByTimestamp[timestampSec][seriesName] = null;
      });
    });

    // Go through the datapoints of all the series and fill in
    // their values (in a format that works for D3 stack helpers).
    props.multiSeries.forEach((series, seriesIndex) => {
      series.values.forEach((point) => {
        const value = parseGraphValue(point[1]);
        const timestampSec = timestampQuantizer(point[0]);
        const seriesName = multiSeriesNames[seriesIndex];
        valuesByTimestamp[timestampSec][seriesName] = value;
      });
    });

    // Stack the graph series in the alphabetical order.
    const valuesForStacking = sortBy(values(valuesByTimestamp), [
      'timestampSec',
    ]);
    const stackFunction = stack().keys(multiSeriesNames);
    const stackedData = stackFunction(valuesForStacking);

    // Finally store the multi-series ready to be graphed.
    const getColor = colorSchemes[props.colorScheme];
    const multiSeries = multiSeriesNames.map((seriesName, seriesIndex) => ({
      name: seriesName,
      key: `${seriesName}:${seriesIndex}`,
      color: getColor(seriesIndex),
      datapoints: timestampSecs.map((timestampSec, timestampIndex) => ({
        timestampSec,
        value: valuesByTimestamp[timestampSec][seriesName],
        offset: stackedData[seriesIndex][timestampIndex][0],
      })),
    }));

    this.setState({ multiSeries });
  }

  yAxisSpread() {
    const yPositions = flatten(
      this.getVisibleMultiSeries().map(series =>
        series.datapoints.map(datapoint =>
          this.getDatapointGraphValue(datapoint)
        )
      )
    );
    return {
      minY: Math.min(this.props.baseMinValue, min(yPositions)),
      maxY: Math.max(this.props.baseMaxValue, max(yPositions)),
    };
  }

  isFadedSeries(series) {
    const { hoveredLegendSeriesKey, selectedLegendSeriesKey } = this.state;
    // Show series as faded if no series is selected and some other series is hovered.
    return (
      !selectedLegendSeriesKey &&
      hoveredLegendSeriesKey &&
      hoveredLegendSeriesKey !== series.key
    );
  }

  isFocusedSeries(series) {
    const { hoveredLegendSeriesKey, selectedLegendSeriesKey } = this.state;
    // Show series as faded if no series is selected and some other series is hovered.
    return (
      hoveredLegendSeriesKey === series.key ||
      selectedLegendSeriesKey === series.key
    );
  }

  getTimestampQuantizer(props = this.props) {
    const { startTime, endTime, stepDuration } = props;
    // Timestamp values are stepDuration seconds apart and they always end at
    // endTime. We make startTime a bit smaller to include it in the range in case
    // (endTime - startTime) is divisible by stepDuration.
    const timestampSecs = range(
      endTime,
      startTime - 1e-6,
      -stepDuration
    ).sort();
    // scaleQuantize would normally map domain in buckets of uniform lengths. To
    // make it map to the nearest point in timestampSecs instead, we need to extend
    // the domain by half of stepDuration at each end.
    const startDomain = first(timestampSecs) - (0.5 * stepDuration);
    const endDomain = last(timestampSecs) + (0.5 * stepDuration);
    return scaleQuantize()
      .domain([startDomain, endDomain])
      .range(timestampSecs);
  }

  getTimeScale() {
    const { width } = this.getSvgBoundingRect();
    const { startTime, endTime } = this.props;
    return scaleLinear()
      .domain([startTime, endTime])
      .range([0, width]);
  }

  getValueScale() {
    const { height } = this.getSvgBoundingRect();
    const { minY, maxY } = this.yAxisSpread();
    return scaleLinear()
      .domain([minY, maxY])
      .range([height, 0]);
  }

  getDatapointGraphValue(datapoint) {
    if (!this.props.showStacked) {
      return datapoint.value;
    }
    return this.getDatapointOffset(datapoint) + datapoint.value;
  }

  getDatapointOffset(datapoint) {
    return this.state.selectedLegendSeriesKey ? 0 : datapoint.offset;
  }

  getVisibleMultiSeries() {
    // If no series is selected, show all of them.
    if (!this.state.selectedLegendSeriesKey) {
      return this.state.multiSeries;
    }
    // Otherwise show only the selected series.
    return this.state.multiSeries.filter(
      series => this.state.selectedLegendSeriesKey === series.key
    );
  }

  render() {
    const { metricUnits } = this.props;
    const { width, height } = this.getSvgBoundingRect();
    const { minY, maxY } = this.yAxisSpread();

    const timeScale = this.getTimeScale();
    const valueScale = this.getValueScale();
    const lineFunction = line()
      .defined(d => d.value !== null)
      .x(d => timeScale(d.timestampSec))
      .y(d => valueScale(d.value));
    const areaFunction = area()
      .defined(d => d.value !== null)
      .x(d => timeScale(d.timestampSec))
      .y0(d => valueScale(this.getDatapointOffset(d)))
      .y1(d => valueScale(this.getDatapointGraphValue(d)));

    const yAxisTicks = units[metricUnits].getSpread(minY, maxY, valueScale);

    return (
      <GraphContainer>
        <AxisLabel>{this.props.yAxisLabel}</AxisLabel>
        <Graph>
          <AxesGrid
            width={width} height={height}
            timeTicks={units.seconds}
            timeScale={timeScale}
            yAxisTicks={yAxisTicks}
          />
          <Canvas
            width="100%" height="100%"
            innerRef={this.saveSvgRef}
            onMouseMove={this.handleGraphMouseMove}
            onMouseLeave={this.handleGraphMouseLeave}
          >
            <g className="graph">
              {this.getVisibleMultiSeries().map(
                series => (
                  this.props.showStacked ? (
                    <SeriesAreaChart
                      key={series.key}
                      faded={this.isFadedSeries(series)}
                      focused={this.isFocusedSeries(series)}
                      d={areaFunction(series.datapoints)}
                      fill={series.color}
                    />
                  ) : (
                    <SeriesLineChart
                      key={series.key}
                      faded={this.isFadedSeries(series)}
                      d={lineFunction(series.datapoints)}
                      stroke={series.color}
                    />
                  )
              ))}
            </g>
          </Canvas>
          <DeploymentAnnotations
            deployments={this.props.deployments}
            timeScale={timeScale}
            height={height}
            width={width}
          />
          <HoverInfo
            datapoints={this.state.hoverPoints}
            mouseX={this.state.hoverXOffset}
            mouseY={this.state.hoverYOffset}
            timestampSec={this.state.hoverTimestampSec}
            valueUnits={units[metricUnits]}
            valueScale={valueScale}
            height={height}
            width={width}
          />
        </Graph>
        {this.state.multiSeries.length > 1 && (
          <GraphLegend
            multiSeries={this.state.multiSeries}
            legendShown={this.props.legendShown}
            legendCollapsable={this.props.legendCollapsable}
            onSelectedLegendSeriesChange={this.handleSelectedLegendSeriesChange}
            onHoveredLegendSeriesChange={this.handleHoveredLegendSeriesChange}
          />
        )}
      </GraphContainer>
    );
  }
}

DashboardGraph.defaultProps = {
  colorScheme: 'mixed',
  metricUnits: 'none',
  showStacked: false,
  baseMinValue: 0.0,
  baseMaxValue: 0.012,
  simpleTooltip: false,
  legendCollapsable: false,
  legendShown: true,
  deployments: [],
};

export default DashboardGraph;
