import {
  interactor,
  isPresent,
  clickable,
  text,
} from '@bigtest/interactor';

@interactor class HeaderDropdown {
  click = clickable('button');
}

@interactor class HeaderDropdownMenu {
  clickEdit = clickable('#edit-instance');
  clickDuplicate = clickable('#copy-instance');
}

@interactor class InstanceViewPage {
  isLoaded = isPresent('[data-test-header-title]');
  whenLoaded() {
    return this.when(() => this.isLoaded);
  }

  title = text('[data-test-header-title]');
  headerDropdown = new HeaderDropdown('[class*=paneHeaderCenterInner---] [class*=dropdown---]');
  headerDropdownMenu = new HeaderDropdownMenu();
}

export default new InstanceViewPage('[data-test-instance-details]');
