import React from 'react';
import { shallow } from 'enzyme';
import renderer from 'react-test-renderer';

import 'jest-styled-components';
import { withTheme } from '../../utils/theme';

import MatchedText from './MatchedText';

const text = 'Rerum molestiae omnis in laudantium.';
const matches = ['um', 'Re'];

describe('<MatchedText />', () => {
  describe('snapshots', () => {
    it('renders default', () => {
      const tree = renderer
        .create(withTheme(<MatchedText text={text} matches={matches} />))
        .toJSON();
      expect(tree).toMatchSnapshot();
    });
  });

  it('chunks properly', () => {
    const component = shallow(<MatchedText text={text} matches={matches} />);
    expect(component.state().chunks).toEqual([
      { text: 'Re', matched: true },
      { text: 'r', matched: false },
      { text: 'um', matched: true },
      { text: ' molestiae omnis in laudanti', matched: false },
      { text: 'um', matched: true },
      { text: '.', matched: false },
    ]);
  });
});
